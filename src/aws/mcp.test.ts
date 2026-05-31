import { describe, it, expect } from "vitest";
import { mapDiscoveredToGraph, unmappedTypes, type DiscoveredResource } from "./mcp";
import { validateGraph, DEFAULT_NODE_SIZE } from "./model";
import { getServiceByCfnType } from "./registry";

// Sanity-check the registry assumptions this test relies on. If any of these
// change the rest of the file's expectations would silently drift, so assert
// them up front.
describe("registry assumptions (join keys)", () => {
  it("maps the CFN types used in these tests to the expected service ids", () => {
    expect(getServiceByCfnType("AWS::EC2::VPC")?.id).toBe("vpc");
    expect(getServiceByCfnType("AWS::EC2::Instance")?.id).toBe("ec2-instance");
    // AWS::EC2::Subnet is declared by both subnet-public and subnet-private;
    // first-wins resolves to subnet-public.
    expect(getServiceByCfnType("AWS::EC2::Subnet")?.id).toBe("subnet-public");
    expect(getServiceByCfnType("AWS::Totally::Madeup")).toBeUndefined();
  });
});

describe("mapDiscoveredToGraph", () => {
  it("maps known CFN types to resources with correct serviceId and source='mcp'", () => {
    const resources: DiscoveredResource[] = [
      { arn: "arn:vpc-1", resourceType: "AWS::EC2::VPC" },
      { arn: "arn:subnet-1", resourceType: "AWS::EC2::Subnet" },
      { arn: "arn:ec2-1", resourceType: "AWS::EC2::Instance" },
    ];

    const graph = mapDiscoveredToGraph(resources);

    expect(graph.resources).toHaveLength(3);
    const byArn = new Map(graph.resources.map((r) => [r.arn, r]));

    expect(byArn.get("arn:vpc-1")?.serviceId).toBe("vpc");
    expect(byArn.get("arn:subnet-1")?.serviceId).toBe("subnet-public");
    expect(byArn.get("arn:ec2-1")?.serviceId).toBe("ec2-instance");

    for (const r of graph.resources) {
      expect(r.source).toBe("mcp");
    }
  });

  it("skips unknown CFN types but keeps the known ones", () => {
    const resources: DiscoveredResource[] = [
      { arn: "arn:vpc-1", resourceType: "AWS::EC2::VPC" },
      { arn: "arn:unknown-1", resourceType: "AWS::Made::Up" },
      { arn: "arn:ec2-1", resourceType: "AWS::EC2::Instance" },
    ];

    const graph = mapDiscoveredToGraph(resources);

    expect(graph.resources.map((r) => r.serviceId)).toEqual(["vpc", "ec2-instance"]);
    expect(graph.resources.some((r) => r.arn === "arn:unknown-1")).toBe(false);
  });

  it("uses the arn as the resource id when present", () => {
    const graph = mapDiscoveredToGraph([
      { arn: "arn:aws:ec2:us-east-1:111:vpc/vpc-abc", resourceType: "AWS::EC2::VPC" },
    ]);

    expect(graph.resources[0].id).toBe("arn:aws:ec2:us-east-1:111:vpc/vpc-abc");
    expect(graph.resources[0].arn).toBe("arn:aws:ec2:us-east-1:111:vpc/vpc-abc");
  });

  it("generates an id and omits arn when no arn is provided", () => {
    const graph = mapDiscoveredToGraph([{ resourceType: "AWS::EC2::VPC" }]);

    const r = graph.resources[0];
    expect(r.id).toBeTruthy();
    expect(typeof r.id).toBe("string");
    expect(r.arn).toBeUndefined();
  });

  it("resolves parentId from parentArn pointing at another discovered resource", () => {
    const resources: DiscoveredResource[] = [
      { arn: "arn:vpc-1", resourceType: "AWS::EC2::VPC" },
      { arn: "arn:subnet-1", resourceType: "AWS::EC2::Subnet", parentArn: "arn:vpc-1" },
    ];

    const graph = mapDiscoveredToGraph(resources);
    const subnet = graph.resources.find((r) => r.arn === "arn:subnet-1")!;

    expect(subnet.parentId).toBe("arn:vpc-1");
  });

  it("leaves parentId undefined when parentArn references a non-discovered resource", () => {
    const graph = mapDiscoveredToGraph([
      { arn: "arn:subnet-1", resourceType: "AWS::EC2::Subnet", parentArn: "arn:does-not-exist" },
    ]);

    expect(graph.resources[0].parentId).toBeUndefined();
  });

  it("does not set a self-parent when parentArn equals the resource's own arn", () => {
    // A resource whose parentArn points at itself would resolve to its own id —
    // a self-parent cycle that infinite-loops tree-walking layout/UI.
    const graph = mapDiscoveredToGraph([
      { arn: "arn:vpc-1", resourceType: "AWS::EC2::VPC", parentArn: "arn:vpc-1" },
    ]);

    expect(graph.resources[0].parentId).toBeUndefined();
    expect(validateGraph(graph)).toEqual([]);
  });

  it("builds relationships and resolves target ARNs to graph ids", () => {
    const resources: DiscoveredResource[] = [
      {
        arn: "arn:ec2-1",
        resourceType: "AWS::EC2::Instance",
        relationships: [{ targetArn: "arn:vpc-1", kind: "depends_on" }],
      },
      { arn: "arn:vpc-1", resourceType: "AWS::EC2::VPC" },
    ];

    const graph = mapDiscoveredToGraph(resources);

    expect(graph.relationships).toHaveLength(1);
    const rel = graph.relationships[0];
    expect(rel.from).toBe("arn:ec2-1");
    expect(rel.to).toBe("arn:vpc-1");
    expect(rel.kind).toBe("depends_on");
    expect(rel.source).toBe("mcp");
    expect(rel.id).toBeTruthy();
  });

  it("defaults relationship kind to 'connects_to' when missing or invalid", () => {
    // Two distinct targets so both edges survive (from,to,kind) de-duplication;
    // a missing kind and an invalid kind must both resolve to "connects_to".
    const resources: DiscoveredResource[] = [
      {
        arn: "arn:a",
        resourceType: "AWS::EC2::VPC",
        relationships: [
          { targetArn: "arn:b" }, // no kind
          { targetArn: "arn:c", kind: "not-a-real-kind" }, // invalid kind
        ],
      },
      { arn: "arn:b", resourceType: "AWS::EC2::VPC" },
      { arn: "arn:c", resourceType: "AWS::EC2::VPC" },
    ];

    const graph = mapDiscoveredToGraph(resources);

    expect(graph.relationships).toHaveLength(2);
    expect(graph.relationships.every((r) => r.kind === "connects_to")).toBe(true);
  });

  it("drops dangling relationship targets that are not in the discovered set", () => {
    const resources: DiscoveredResource[] = [
      {
        arn: "arn:ec2-1",
        resourceType: "AWS::EC2::Instance",
        relationships: [
          { targetArn: "arn:vpc-1", kind: "depends_on" },
          { targetArn: "arn:nonexistent", kind: "connects_to" },
        ],
      },
      { arn: "arn:vpc-1", resourceType: "AWS::EC2::VPC" },
    ];

    const graph = mapDiscoveredToGraph(resources);

    expect(graph.relationships).toHaveLength(1);
    expect(graph.relationships[0].to).toBe("arn:vpc-1");
  });

  it("drops relationships whose target was skipped as an unmapped type", () => {
    const resources: DiscoveredResource[] = [
      {
        arn: "arn:ec2-1",
        resourceType: "AWS::EC2::Instance",
        relationships: [{ targetArn: "arn:unknown-1", kind: "connects_to" }],
      },
      // present in input but unmapped, so its arn is never indexed
      { arn: "arn:unknown-1", resourceType: "AWS::Made::Up" },
    ];

    const graph = mapDiscoveredToGraph(resources);

    expect(graph.relationships).toHaveLength(0);
  });

  it("filters properties down to the service's configFields keys", () => {
    const graph = mapDiscoveredToGraph([
      {
        arn: "arn:vpc-1",
        resourceType: "AWS::EC2::VPC",
        properties: {
          // vpc configFields: cidr, enableDnsHostnames, tenancy
          cidr: "10.0.0.0/16",
          tenancy: "dedicated",
          enableDnsHostnames: true,
          // these are NOT in configFields and must be stripped
          CidrBlockAssociations: ["foo"],
          OwnerId: "123",
          internalFlag: true,
        },
      },
    ]);

    const config = graph.resources[0].config;
    expect(config).toEqual({
      cidr: "10.0.0.0/16",
      tenancy: "dedicated",
      enableDnsHostnames: true,
    });
    expect(config).not.toHaveProperty("CidrBlockAssociations");
    expect(config).not.toHaveProperty("OwnerId");
    expect(config).not.toHaveProperty("internalFlag");
  });

  it("produces an empty config when no properties are supplied", () => {
    const graph = mapDiscoveredToGraph([{ arn: "arn:vpc-1", resourceType: "AWS::EC2::VPC" }]);
    expect(graph.resources[0].config).toEqual({});
  });

  it("assigns grid positions (5 columns) using the documented layout constants", () => {
    // 6 VPCs -> 5 in row 0, 1 in row 1.
    const resources: DiscoveredResource[] = Array.from({ length: 6 }, (_, i) => ({
      arn: `arn:vpc-${i}`,
      resourceType: "AWS::EC2::VPC",
    }));

    const graph = mapDiscoveredToGraph(resources);

    // Layout constants from mcp.ts: node size = DEFAULT_NODE_SIZE, COL_GAP=80,
    // ROW_GAP=60, COLS=5, ORIGIN_X=80, ORIGIN_Y=80.
    const { w: nodeW, h: nodeH } = DEFAULT_NODE_SIZE;
    const colStep = nodeW + 80;
    const rowStep = nodeH + 60;

    const positions = graph.resources.map((r) => r.position!);

    // every node has the standard size
    for (const p of positions) {
      expect(p.w).toBe(nodeW);
      expect(p.h).toBe(nodeH);
    }

    // index 0 -> col 0, row 0
    expect(positions[0]).toMatchObject({ x: 80, y: 80 });
    // index 4 -> col 4, row 0
    expect(positions[4]).toMatchObject({ x: 80 + 4 * colStep, y: 80 });
    // index 5 -> col 0, row 1
    expect(positions[5]).toMatchObject({ x: 80, y: 80 + rowStep });
  });

  it("derives name from name, then logicalId, then the service name", () => {
    const graph = mapDiscoveredToGraph([
      { arn: "arn:1", resourceType: "AWS::EC2::VPC", name: "prod-vpc", logicalId: "MyVpc" },
      { arn: "arn:2", resourceType: "AWS::EC2::VPC", logicalId: "FallbackLogical" },
      { arn: "arn:3", resourceType: "AWS::EC2::VPC" },
    ]);

    expect(graph.resources[0].name).toBe("prod-vpc");
    expect(graph.resources[1].name).toBe("FallbackLogical");
    expect(graph.resources[2].name).toBe(getServiceByCfnType("AWS::EC2::VPC")!.name);
  });

  it("carries region and accountId onto the instance when provided, omits otherwise", () => {
    const graph = mapDiscoveredToGraph([
      {
        arn: "arn:1",
        resourceType: "AWS::EC2::VPC",
        region: "us-west-2",
        accountId: "123456789012",
      },
      { arn: "arn:2", resourceType: "AWS::EC2::VPC" },
    ]);

    expect(graph.resources[0].region).toBe("us-west-2");
    expect(graph.resources[0].accountId).toBe("123456789012");
    expect(graph.resources[1].region).toBeUndefined();
    expect(graph.resources[1].accountId).toBeUndefined();
  });

  it("uses the provided graph name and falls back to a default", () => {
    expect(mapDiscoveredToGraph([], { name: "My Env" }).name).toBe("My Env");
    expect(mapDiscoveredToGraph([]).name).toBe("Discovered Infrastructure");
  });

  it("returns a structurally valid graph (validateGraph passes)", () => {
    const resources: DiscoveredResource[] = [
      { arn: "arn:vpc-1", resourceType: "AWS::EC2::VPC", properties: { cidr: "10.0.0.0/16" } },
      {
        arn: "arn:subnet-1",
        resourceType: "AWS::EC2::Subnet",
        parentArn: "arn:vpc-1",
        properties: { cidr: "10.0.1.0/24", az: "us-east-1a" },
      },
      {
        arn: "arn:ec2-1",
        resourceType: "AWS::EC2::Instance",
        parentArn: "arn:subnet-1",
        properties: { instanceType: "t3.medium" },
        relationships: [
          { targetArn: "arn:subnet-1", kind: "depends_on" },
          { targetArn: "arn:dangling", kind: "connects_to" },
        ],
      },
      { resourceType: "AWS::Unknown::Type" }, // skipped
    ];

    const graph = mapDiscoveredToGraph(resources);

    expect(validateGraph(graph)).toEqual([]);
  });

  it("de-duplicates resources sharing an ARN (first wins) so ids stay unique", () => {
    const resources: DiscoveredResource[] = [
      { arn: "arn:dup", resourceType: "AWS::EC2::VPC", name: "first" },
      { arn: "arn:dup", resourceType: "AWS::EC2::VPC", name: "second" },
      { arn: "arn:dup", resourceType: "AWS::EC2::Instance", name: "third" },
    ];

    const graph = mapDiscoveredToGraph(resources);

    // Only the first occurrence is kept.
    expect(graph.resources).toHaveLength(1);
    expect(graph.resources[0].name).toBe("first");
    expect(graph.resources[0].serviceId).toBe("vpc");
    // Unique ids => validateGraph reports no duplicate-id errors.
    expect(validateGraph(graph)).toEqual([]);
  });

  it("skips self-loop relationships (targetArn === source arn)", () => {
    const resources: DiscoveredResource[] = [
      {
        arn: "arn:vpc-1",
        resourceType: "AWS::EC2::VPC",
        relationships: [
          { targetArn: "arn:vpc-1", kind: "depends_on" }, // self-loop -> dropped
          { targetArn: "arn:vpc-2", kind: "peers_with" }, // valid
        ],
      },
      { arn: "arn:vpc-2", resourceType: "AWS::EC2::VPC" },
    ];

    const graph = mapDiscoveredToGraph(resources);

    expect(graph.relationships).toHaveLength(1);
    expect(graph.relationships[0].from).toBe("arn:vpc-1");
    expect(graph.relationships[0].to).toBe("arn:vpc-2");
    expect(graph.relationships.every((r) => r.from !== r.to)).toBe(true);
    expect(validateGraph(graph)).toEqual([]);
  });

  it("de-duplicates relationships by (from, to, kind)", () => {
    const resources: DiscoveredResource[] = [
      {
        arn: "arn:a",
        resourceType: "AWS::EC2::Instance",
        relationships: [
          { targetArn: "arn:b", kind: "depends_on" },
          { targetArn: "arn:b", kind: "depends_on" }, // exact dup -> collapsed
          { targetArn: "arn:b", kind: "connects_to" }, // different kind -> kept
        ],
      },
      { arn: "arn:b", resourceType: "AWS::EC2::VPC" },
    ];

    const graph = mapDiscoveredToGraph(resources);

    expect(graph.relationships).toHaveLength(2);
    const kinds = graph.relationships.map((r) => r.kind).sort();
    expect(kinds).toEqual(["connects_to", "depends_on"]);
    for (const r of graph.relationships) {
      expect(r.from).toBe("arn:a");
      expect(r.to).toBe("arn:b");
    }
    expect(validateGraph(graph)).toEqual([]);
  });

  it("handles an empty input list", () => {
    const graph = mapDiscoveredToGraph([]);
    expect(graph.resources).toEqual([]);
    expect(graph.relationships).toEqual([]);
    expect(validateGraph(graph)).toEqual([]);
  });
});

describe("unmappedTypes", () => {
  it("returns the distinct unknown CFN types only", () => {
    const resources: DiscoveredResource[] = [
      { resourceType: "AWS::EC2::VPC" },
      { resourceType: "AWS::Made::Up" },
      { resourceType: "AWS::Made::Up" }, // duplicate -> collapsed
      { resourceType: "AWS::Another::Mystery" },
      { resourceType: "AWS::EC2::Instance" },
    ];

    const result = unmappedTypes(resources);

    expect(result).toHaveLength(2);
    expect(new Set(result)).toEqual(new Set(["AWS::Made::Up", "AWS::Another::Mystery"]));
  });

  it("returns an empty array when every type is known", () => {
    expect(
      unmappedTypes([{ resourceType: "AWS::EC2::VPC" }, { resourceType: "AWS::EC2::Instance" }]),
    ).toEqual([]);
  });

  it("returns an empty array for empty input", () => {
    expect(unmappedTypes([])).toEqual([]);
  });
});
