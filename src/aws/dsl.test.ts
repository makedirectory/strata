import { describe, expect, it } from "vitest";
import { dslToGraph, graphToDsl } from "./dsl";
import { emptyGraph, SCHEMA_VERSION, type InfrastructureGraph } from "./model";

/** A representative graph exercising every modeled field. */
function sampleGraph(): InfrastructureGraph {
  return {
    id: "graph-1",
    name: "Prod VPC",
    description: "A representative environment",
    accounts: [
      {
        id: "acct-1",
        accountId: "123456789012",
        name: "Production",
        provider: "aws",
        environment: "prod",
        color: "#ff8800",
      },
    ],
    resources: [
      {
        id: "vpc-1",
        serviceId: "vpc",
        name: "main-vpc",
        accountId: "acct-1",
        region: "us-east-1",
        config: { cidrBlock: "10.0.0.0/16" },
        tags: { team: "platform", env: "prod" },
        source: "manual",
      },
      {
        id: "subnet-1",
        serviceId: "subnet-public",
        name: "public-a",
        accountId: "acct-1",
        region: "us-east-1",
        parentId: "vpc-1",
        config: {},
        source: "imported",
        arn: "arn:aws:ec2:us-east-1:123456789012:subnet/subnet-abc",
      },
      {
        id: "ec2-1",
        serviceId: "ec2-instance",
        name: "web-server",
        parentId: "subnet-1",
        config: { instanceType: "t3.micro" },
        source: "manual",
      },
    ],
    relationships: [
      {
        id: "rel-1",
        from: "subnet-1",
        to: "vpc-1",
        kind: "contains",
        label: "in vpc",
        source: "manual",
      },
      {
        id: "rel-2",
        from: "subnet-1",
        to: "vpc-1",
        kind: "routes_to",
        destinationCidr: "0.0.0.0/0",
      },
    ],
    viewport: { x: 100, y: 50, scale: 1.5 },
    schemaVersion: SCHEMA_VERSION,
  };
}

describe("graphToDsl", () => {
  it("emits a readable YAML string with the modeled fields", () => {
    const dsl = graphToDsl(sampleGraph());
    expect(typeof dsl).toBe("string");
    expect(dsl).toContain("name: Prod VPC");
    expect(dsl).toContain("service: vpc");
    expect(dsl).toContain("schemaVersion: 1");
  });

  it("is deterministic across runs", () => {
    const g = sampleGraph();
    expect(graphToDsl(g)).toBe(graphToDsl(g));
  });

  it("omits empty config and tags", () => {
    const dsl = graphToDsl(sampleGraph());
    // subnet-1 has empty config {} — should not emit an empty config key for it.
    // Spot-check that no `config: {}` appears.
    expect(dsl).not.toContain("config: {}");
  });
});

describe("dslToGraph", () => {
  it("round-trips the modeled fields (graph -> dsl -> graph)", () => {
    const original = sampleGraph();
    const { graph, errors } = dslToGraph(graphToDsl(original));
    expect(errors).toEqual([]);

    // id is not part of the DSL document; compare the modeled fields.
    expect(graph.name).toBe(original.name);
    expect(graph.description).toBe(original.description);
    expect(graph.schemaVersion).toBe(original.schemaVersion);
    expect(graph.viewport).toEqual(original.viewport);
    expect(graph.accounts).toEqual(original.accounts);
    expect(graph.relationships).toEqual(original.relationships);

    // Resources: empty config round-trips to {}, matching the original.
    expect(graph.resources).toEqual(original.resources);
  });

  it("round-trips each resource's canvas position (graph -> dsl -> graph)", () => {
    const original = sampleGraph();
    original.resources[0].position = { x: 10, y: 20, w: 200, h: 120 };
    original.resources[1].position = { x: -5, y: 0, w: 64, h: 64 };
    // resources[2] intentionally has no position.
    const { graph, errors } = dslToGraph(graphToDsl(original));
    expect(errors).toEqual([]);
    expect(graph.resources[0].position).toEqual({ x: 10, y: 20, w: 200, h: 120 });
    expect(graph.resources[1].position).toEqual({ x: -5, y: 0, w: 64, h: 64 });
    expect(graph.resources[2].position).toBeUndefined();
  });

  it("ignores a malformed position (missing/non-number fields)", () => {
    const dsl = [
      "name: Test",
      "schemaVersion: 1",
      "resources:",
      "  - id: a",
      "    service: vpc",
      "    name: vpc-a",
      "    source: manual",
      "    position:",
      "      x: 10",
      "      y: 20",
      "      w: oops", // non-number -> whole position discarded
      "      h: 40",
    ].join("\n");
    const { graph, errors } = dslToGraph(dsl);
    expect(errors).toEqual([]);
    expect(graph.resources[0].position).toBeUndefined();
  });

  it("drops a position with a non-finite field (NaN / Infinity), keeping valid ones", () => {
    // BUG 3: parsePosition guarded with `typeof x === "number"`, which accepts
    // NaN/Infinity; the docstring promises FINITE numbers, so such a node must
    // stay unpositioned.
    const dsl = [
      "name: Test",
      "schemaVersion: 1",
      "resources:",
      "  - id: a",
      "    service: vpc",
      "    name: vpc-a",
      "    source: manual",
      "    position:",
      "      x: .nan", // NaN -> whole position discarded
      "      y: 20",
      "      w: 100",
      "      h: 40",
      "  - id: b",
      "    service: vpc",
      "    name: vpc-b",
      "    source: manual",
      "    position:",
      "      x: 10",
      "      y: .inf", // Infinity -> whole position discarded
      "      w: 100",
      "      h: 40",
      "  - id: c",
      "    service: vpc",
      "    name: vpc-c",
      "    source: manual",
      "    position:",
      "      x: 10",
      "      y: 20",
      "      w: 100",
      "      h: 40",
    ].join("\n");
    const { graph, errors } = dslToGraph(dsl);
    expect(errors).toEqual([]);
    expect(graph.resources[0].position).toBeUndefined();
    expect(graph.resources[1].position).toBeUndefined();
    // A fully-finite position still round-trips.
    expect(graph.resources[2].position).toEqual({ x: 10, y: 20, w: 100, h: 40 });
  });

  it("round-trips a populated raw IaC sidecar; absent raw stays undefined (not {})", () => {
    const original = sampleGraph();
    // Resource 0 carries a terraform raw with properties; resource 1 a
    // cloudformation raw with dependsOn/condition/metadata. Resource 2 has none.
    original.resources[0].raw = {
      format: "terraform",
      type: "aws_vpc",
      properties: { cidr_block: "10.0.0.0/16", tags: { Name: "main" } },
    };
    original.resources[1].raw = {
      format: "cloudformation",
      type: "AWS::EC2::Subnet",
      properties: { CidrBlock: { Ref: "SubnetCidr" } },
      dependsOn: ["main-vpc"],
      condition: "IsProd",
      metadata: { "aws:cdk:path": "Stack/Subnet" },
    };
    const { graph, errors } = dslToGraph(graphToDsl(original));
    expect(errors).toEqual([]);
    expect(graph.resources[0].raw).toEqual(original.resources[0].raw);
    expect(graph.resources[1].raw).toEqual(original.resources[1].raw);
    // A resource without raw stays undefined — not reconstructed as {}.
    expect(graph.resources[2].raw).toBeUndefined();
    expect("raw" in graph.resources[2]).toBe(false);
  });

  it("round-trips an ARM raw sidecar with apiVersion", () => {
    const original = sampleGraph();
    original.resources[0].raw = {
      format: "arm",
      type: "Microsoft.Network/virtualNetworks",
      apiVersion: "2021-05-01",
      properties: { addressSpace: { addressPrefixes: ["10.0.0.0/16"] } },
    };
    const { graph, errors } = dslToGraph(graphToDsl(original));
    expect(errors).toEqual([]);
    expect(graph.resources[0].raw).toEqual(original.resources[0].raw);
  });

  it("drops a raw sidecar with an invalid format and reports it via errors[]", () => {
    const dsl = [
      "name: Test",
      "schemaVersion: 1",
      "resources:",
      "  - id: a",
      "    service: vpc",
      "    name: vpc-a",
      "    source: manual",
      "    raw:",
      "      format: bogus",
      "      type: aws_vpc",
    ].join("\n");
    const { graph, errors } = dslToGraph(dsl);
    expect(graph.resources[0].raw).toBeUndefined();
    expect(errors.some((e) => e.includes("invalid raw.format"))).toBe(true);
  });

  it("drops a raw sidecar missing a string type and reports it via errors[]", () => {
    const dsl = [
      "name: Test",
      "schemaVersion: 1",
      "resources:",
      "  - id: a",
      "    service: vpc",
      "    name: vpc-a",
      "    source: manual",
      "    raw:",
      "      format: terraform",
    ].join("\n");
    const { graph, errors } = dslToGraph(dsl);
    expect(graph.resources[0].raw).toBeUndefined();
    expect(errors.some((e) => e.includes("missing a string raw.type"))).toBe(true);
  });

  it("is idempotent (dsl -> graph -> dsl -> graph)", () => {
    const first = dslToGraph(graphToDsl(sampleGraph()));
    const second = dslToGraph(graphToDsl(first.graph));
    expect(second.errors).toEqual([]);
    expect(second.graph).toEqual(first.graph);
  });

  it("returns a single parse error for malformed YAML without throwing", () => {
    const { graph, errors } = dslToGraph(":\n  - [unbalanced");
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toMatch(/YAML parse error/);
    expect(graph.resources).toEqual([]);
  });

  it("flags an empty document", () => {
    const { errors } = dslToGraph("");
    expect(errors).toContain("DSL document is empty");
  });

  it("flags a non-object document", () => {
    const { errors } = dslToGraph("- just\n- a\n- list");
    expect(errors).toContain("DSL document is not a mapping/object");
  });

  it("reports unknown serviceId without dropping the resource", () => {
    const dsl = [
      "name: Test",
      "schemaVersion: 1",
      "accounts: []",
      "resources:",
      "  - id: x1",
      "    service: not-a-real-service",
      "    name: mystery",
      "    source: manual",
      "relationships: []",
    ].join("\n");
    const { graph, errors } = dslToGraph(dsl);
    expect(graph.resources).toHaveLength(1);
    expect(errors.some((e) => e.includes("unknown service not-a-real-service"))).toBe(true);
  });

  it("does not report the same unknown service twice", () => {
    const dsl = [
      "name: Test",
      "schemaVersion: 1",
      "resources:",
      "  - id: x1",
      "    service: bogus",
      "    name: mystery",
      "    source: manual",
    ].join("\n");
    const { errors } = dslToGraph(dsl);
    const matches = errors.filter((e) => e.includes("unknown service bogus"));
    expect(matches).toHaveLength(1);
  });

  it("reports an unknown relationship kind", () => {
    const dsl = [
      "name: Test",
      "schemaVersion: 1",
      "resources:",
      "  - id: a",
      "    service: vpc",
      "    name: vpc-a",
      "    source: manual",
      "  - id: b",
      "    service: vpc",
      "    name: vpc-b",
      "    source: manual",
      "relationships:",
      "  - id: r1",
      "    from: a",
      "    to: b",
      "    kind: teleports_to",
    ].join("\n");
    const { errors } = dslToGraph(dsl);
    expect(errors.some((e) => e.includes("unknown kind teleports_to"))).toBe(true);
  });

  it("surfaces dangling relationship refs via validateGraph", () => {
    const dsl = [
      "name: Test",
      "schemaVersion: 1",
      "resources:",
      "  - id: a",
      "    service: vpc",
      "    name: vpc-a",
      "    source: manual",
      "relationships:",
      "  - id: r1",
      "    from: a",
      "    to: ghost",
      "    kind: peers_with",
    ].join("\n");
    const { errors } = dslToGraph(dsl);
    expect(errors.some((e) => e.includes("missing to ghost"))).toBe(true);
  });

  it("flags a resource missing required fields", () => {
    const dsl = [
      "name: Test",
      "schemaVersion: 1",
      "resources:",
      "  - id: a",
      "    name: no-service",
    ].join("\n");
    const { graph, errors } = dslToGraph(dsl);
    expect(graph.resources).toHaveLength(0);
    expect(errors.some((e) => e.includes("missing id, service, or name"))).toBe(true);
  });

  it("round-trips an empty graph", () => {
    const g = emptyGraph("Blank");
    g.id = "";
    const { graph, errors } = dslToGraph(graphToDsl(g));
    expect(errors).toEqual([]);
    expect(graph.name).toBe("Blank");
    expect(graph.resources).toEqual([]);
    expect(graph.relationships).toEqual([]);
    expect(graph.accounts).toEqual([]);
  });

  it("defaults source to manual when omitted or invalid", () => {
    const dsl = [
      "name: Test",
      "schemaVersion: 1",
      "resources:",
      "  - id: a",
      "    service: vpc",
      "    name: vpc-a",
      "    source: bogus",
    ].join("\n");
    const { graph } = dslToGraph(dsl);
    expect(graph.resources[0].source).toBe("manual");
  });
});
