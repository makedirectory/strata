import { describe, it, expect } from "vitest";
import {
  importIaC,
  importCloudFormation,
  importTerraform,
  detectFormat,
  buildGraph,
  TF_TYPE_TO_SERVICE_ID,
  type IacImportResult,
  type ResolvedItem,
} from "./iac";
import { validateGraph } from "./model";
import { getServiceByCfnType } from "./registry";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function byId(result: IacImportResult, id: string) {
  const r = result.graph.resources.find((x) => x.id === id);
  if (!r) throw new Error(`resource ${id} not found`);
  return r;
}

function relKinds(result: IacImportResult, from: string, to: string): string[] {
  return result.graph.relationships
    .filter((r) => r.from === from && r.to === to)
    .map((r) => r.kind);
}

/** Common structural invariants every produced graph must satisfy. */
function assertValidGraph(result: IacImportResult) {
  expect(validateGraph(result.graph)).toEqual([]);
  const ids = result.graph.resources.map((r) => r.id);
  expect(new Set(ids).size).toBe(ids.length); // unique ids
  // No relationship is a self-loop and no duplicates.
  const relKeys = result.graph.relationships.map((r) => `${r.from}|${r.to}|${r.kind}`);
  expect(new Set(relKeys).size).toBe(relKeys.length);
  for (const r of result.graph.relationships) {
    expect(r.from).not.toBe(r.to);
  }
  for (const r of result.graph.resources) {
    expect(r.source).toBe("imported");
  }
}

// ---------------------------------------------------------------------------
// CloudFormation fixtures
// ---------------------------------------------------------------------------

const CFN_TEMPLATE = {
  AWSTemplateFormatVersion: "2010-09-09",
  Resources: {
    MyVpc: {
      Type: "AWS::EC2::VPC",
      Properties: { CidrBlock: "10.0.0.0/16", cidr: "10.0.0.0/16" },
    },
    MySubnet: {
      Type: "AWS::EC2::Subnet",
      Properties: { VpcId: { Ref: "MyVpc" }, CidrBlock: "10.0.1.0/24", cidr: "10.0.1.0/24" },
    },
    MyInstance: {
      Type: "AWS::EC2::Instance",
      DependsOn: ["MySg"],
      Properties: {
        SubnetId: { Ref: "MySubnet" },
        SecurityGroupIds: [{ Ref: "MySg" }],
        ImageId: "ami-123",
      },
    },
    MySg: {
      Type: "AWS::EC2::SecurityGroup",
      Properties: { VpcId: { Ref: "MyVpc" }, GroupDescription: "test" },
    },
    Mystery: {
      Type: "AWS::Made::Up",
      Properties: {},
    },
  },
};

describe("importCloudFormation", () => {
  it("maps cfnType to the correct serviceIds with source 'imported'", () => {
    const res = importCloudFormation(CFN_TEMPLATE);
    expect(res.format).toBe("cloudformation");
    expect(byId(res, "MyVpc").serviceId).toBe("vpc");
    // First-wins: AWS::EC2::Subnet resolves to subnet-public (declared first).
    expect(byId(res, "MySubnet").serviceId).toBe("subnet-public");
    expect(byId(res, "MyInstance").serviceId).toBe("ec2-instance");
    expect(byId(res, "MySg").serviceId).toBe("security-group");
    for (const r of res.graph.resources) expect(r.source).toBe("imported");
  });

  it("derives parentId from containment props (subnet->vpc, instance->subnet)", () => {
    const res = importCloudFormation(CFN_TEMPLATE);
    expect(byId(res, "MySubnet").parentId).toBe("MyVpc");
    expect(byId(res, "MyInstance").parentId).toBe("MySubnet");
    // SG has VpcId but VPC is not in its containment chain order before... VpcId
    // IS a containment prop, so SG's parent is the VPC.
    expect(byId(res, "MySg").parentId).toBe("MyVpc");
    // VPC is top-level.
    expect(byId(res, "MyVpc").parentId).toBeUndefined();
  });

  it("produces depends_on relationships from DependsOn + Ref, excluding the parent", () => {
    const res = importCloudFormation(CFN_TEMPLATE);
    // Instance depends_on the SG (via DependsOn and via SecurityGroupIds Ref) —
    // de-duplicated to a single relationship.
    expect(relKinds(res, "MyInstance", "MySg")).toEqual(["depends_on"]);
    // The instance's parent (subnet) must NOT also appear as a relationship.
    expect(relKinds(res, "MyInstance", "MySubnet")).toEqual([]);
    // Subnet's only ref is its parent VPC, so it emits no relationships.
    expect(relKinds(res, "MySubnet", "MyVpc")).toEqual([]);
    // SG references its parent VPC only -> no relationship.
    expect(relKinds(res, "MySg", "MyVpc")).toEqual([]);
  });

  it("collects unknown Types in unmappedTypes and skips them", () => {
    const res = importCloudFormation(CFN_TEMPLATE);
    expect(res.unmappedTypes).toContain("AWS::Made::Up");
    expect(res.graph.resources.find((r) => r.id === "Mystery")).toBeUndefined();
    expect(res.warnings.some((w) => /not yet in the registry/.test(w))).toBe(true);
  });

  it("filters config to the service's known fields", () => {
    const res = importCloudFormation(CFN_TEMPLATE);
    // vpc service has a `cidr` field; `CidrBlock` is not a config field.
    expect(byId(res, "MyVpc").config).toEqual({ cidr: "10.0.0.0/16" });
  });

  it("produces a graph that passes validateGraph with unique ids", () => {
    assertValidGraph(importCloudFormation(CFN_TEMPLATE));
  });

  it("throws when there is no top-level Resources", () => {
    expect(() => importCloudFormation({ foo: 1 })).toThrow(/Resources/);
  });
});

// ---------------------------------------------------------------------------
// CloudFormation YAML (short tags)
// ---------------------------------------------------------------------------

const CFN_YAML = `
AWSTemplateFormatVersion: "2010-09-09"
Resources:
  MyVpc:
    Type: AWS::EC2::VPC
    Properties:
      CidrBlock: 10.0.0.0/16
  MySubnet:
    Type: AWS::EC2::Subnet
    Properties:
      VpcId: !Ref MyVpc
      CidrBlock: 10.0.1.0/24
  MyInstance:
    Type: AWS::EC2::Instance
    DependsOn: MySg
    Properties:
      SubnetId: !Ref MySubnet
      AvailabilityZone: !GetAtt MySubnet.AvailabilityZone
      UserData: !Sub "host-\${MySg}"
  MySg:
    Type: AWS::EC2::SecurityGroup
    Properties:
      GroupDescription: test
`;

describe("importIaC with CloudFormation YAML short tags", () => {
  it("parses !Ref/!GetAtt/!Sub and maps correctly", () => {
    const res = importIaC(CFN_YAML);
    expect(res.format).toBe("cloudformation");
    expect(byId(res, "MyVpc").serviceId).toBe("vpc");
    expect(byId(res, "MySubnet").parentId).toBe("MyVpc");
    expect(byId(res, "MyInstance").parentId).toBe("MySubnet");
    // DependsOn (scalar) -> SG; !Sub references MySg too -> single relationship.
    expect(relKinds(res, "MyInstance", "MySg")).toEqual(["depends_on"]);
    assertValidGraph(res);
  });
});

// ---------------------------------------------------------------------------
// Terraform (show -json: state)
// ---------------------------------------------------------------------------

const TF_STATE = {
  format_version: "1.0",
  terraform_version: "1.6.0",
  values: {
    root_module: {
      resources: [
        {
          address: "aws_vpc.main",
          type: "aws_vpc",
          name: "main",
          values: { id: "vpc-aaa", cidr_block: "10.0.0.0/16" },
        },
        {
          address: "aws_security_group.web",
          type: "aws_security_group",
          name: "web",
          values: { id: "sg-www", vpc_id: "vpc-aaa" },
        },
        {
          address: "aws_made_up.thing",
          type: "aws_made_up",
          name: "thing",
          values: { id: "x-1" },
        },
      ],
      child_modules: [
        {
          resources: [
            {
              address: "module.net.aws_subnet.private",
              type: "aws_subnet",
              name: "private",
              values: { id: "subnet-bbb", vpc_id: "vpc-aaa", cidr_block: "10.0.1.0/24" },
            },
            {
              address: "module.net.aws_instance.app",
              type: "aws_instance",
              name: "app",
              values: { id: "i-ccc", subnet_id: "subnet-bbb" },
              depends_on: ["aws_security_group.web"],
            },
          ],
        },
      ],
    },
  },
};

describe("importTerraform (state)", () => {
  it("maps tf types via TF_TYPE_TO_SERVICE_ID and walks child_modules", () => {
    const res = importTerraform(TF_STATE);
    expect(res.format).toBe("terraform");
    expect(byId(res, "aws_vpc.main").serviceId).toBe("vpc");
    expect(byId(res, "aws_security_group.web").serviceId).toBe("security-group");
    // child_modules walked:
    expect(byId(res, "module.net.aws_subnet.private").serviceId).toBe("subnet-private");
    expect(byId(res, "module.net.aws_instance.app").serviceId).toBe("ec2-instance");
  });

  it("derives containment via id->address (vpc_id / subnet_id)", () => {
    const res = importTerraform(TF_STATE);
    expect(byId(res, "module.net.aws_subnet.private").parentId).toBe("aws_vpc.main");
    expect(byId(res, "module.net.aws_instance.app").parentId).toBe("module.net.aws_subnet.private");
    expect(byId(res, "aws_security_group.web").parentId).toBe("aws_vpc.main");
  });

  it("emits depends_on relationships and excludes the parent", () => {
    const res = importTerraform(TF_STATE);
    expect(relKinds(res, "module.net.aws_instance.app", "aws_security_group.web")).toEqual([
      "depends_on",
    ]);
  });

  it("collects unmapped tf types and skips them", () => {
    const res = importTerraform(TF_STATE);
    expect(res.unmappedTypes).toContain("aws_made_up");
    expect(res.graph.resources.find((r) => r.id === "aws_made_up.thing")).toBeUndefined();
  });

  it("produces a valid graph with unique ids", () => {
    assertValidGraph(importTerraform(TF_STATE));
  });
});

// ---------------------------------------------------------------------------
// Terraform plan format
// ---------------------------------------------------------------------------

const TF_PLAN = {
  format_version: "1.1",
  resource_changes: [
    {
      address: "aws_vpc.main",
      type: "aws_vpc",
      name: "main",
      change: { after: { cidr_block: "10.0.0.0/16" } },
    },
    {
      address: "aws_s3_bucket.data",
      type: "aws_s3_bucket",
      name: "data",
      change: { after: { bucket: "my-data" } },
    },
    {
      address: "aws_unknown.x",
      type: "aws_unknown",
      name: "x",
      change: { after: {} },
    },
  ],
};

describe("importTerraform (plan)", () => {
  it("maps resource_changes[].change.after", () => {
    const res = importTerraform(TF_PLAN);
    expect(res.format).toBe("terraform");
    expect(byId(res, "aws_vpc.main").serviceId).toBe("vpc");
    expect(byId(res, "aws_s3_bucket.data").serviceId).toBe("s3-bucket");
    expect(res.unmappedTypes).toContain("aws_unknown");
    assertValidGraph(res);
  });

  it("throws on a Terraform doc that is neither state nor plan", () => {
    expect(() => importTerraform({ foo: 1 })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// detectFormat
// ---------------------------------------------------------------------------

describe("detectFormat", () => {
  it("classifies CloudFormation via Resources", () => {
    expect(detectFormat({ Resources: {} })).toBe("cloudformation");
  });
  it("classifies CloudFormation via AWSTemplateFormatVersion", () => {
    expect(detectFormat({ AWSTemplateFormatVersion: "2010-09-09" })).toBe("cloudformation");
  });
  it("classifies Terraform via values", () => {
    expect(detectFormat({ values: {} })).toBe("terraform");
  });
  it("classifies Terraform via planned_values", () => {
    expect(detectFormat({ planned_values: {} })).toBe("terraform");
  });
  it("classifies Terraform via resource_changes", () => {
    expect(detectFormat({ resource_changes: [] })).toBe("terraform");
  });
  it("throws on an unknown document", () => {
    expect(() => detectFormat({ random: true })).toThrow(/detect/i);
    expect(() => detectFormat(42)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// importIaC auto-detect + forced format
// ---------------------------------------------------------------------------

describe("importIaC dispatch", () => {
  it("auto-detects CloudFormation JSON", () => {
    const res = importIaC(JSON.stringify(CFN_TEMPLATE));
    expect(res.format).toBe("cloudformation");
    assertValidGraph(res);
  });

  it("auto-detects Terraform JSON", () => {
    const res = importIaC(JSON.stringify(TF_STATE));
    expect(res.format).toBe("terraform");
    assertValidGraph(res);
  });

  it("honors a forced format", () => {
    // Force terraform on a plan-shaped doc passed as JSON.
    const res = importIaC(JSON.stringify(TF_PLAN), { format: "terraform" });
    expect(res.format).toBe("terraform");
  });

  it("uses a provided name", () => {
    const res = importIaC(JSON.stringify(CFN_TEMPLATE), { name: "My Stack" });
    expect(res.graph.name).toBe("My Stack");
  });
});

// ---------------------------------------------------------------------------
// TF_TYPE_TO_SERVICE_ID integrity
// ---------------------------------------------------------------------------

describe("TF_TYPE_TO_SERVICE_ID", () => {
  it("has the expected core mappings", () => {
    expect(TF_TYPE_TO_SERVICE_ID.aws_vpc).toBe("vpc");
    expect(TF_TYPE_TO_SERVICE_ID.aws_subnet).toBe("subnet-private");
    expect(TF_TYPE_TO_SERVICE_ID.aws_instance).toBe("ec2-instance");
  });

  it("maps the newly-added TF types", () => {
    expect(TF_TYPE_TO_SERVICE_ID.aws_ecs_task_definition).toBe("fargate");
    expect(TF_TYPE_TO_SERVICE_ID.aws_eks_node_group).toBe("eks-cluster");
    expect(TF_TYPE_TO_SERVICE_ID.aws_lb_listener).toBe("elastic-load-balancer");
    expect(TF_TYPE_TO_SERVICE_ID.aws_batch_job_queue).toBe("batch");
  });
});

// ---------------------------------------------------------------------------
// buildGraph (unit) — exercised directly with hand-built ResolvedItem[]
// ---------------------------------------------------------------------------

describe("buildGraph (unit)", () => {
  it("defaults config to {} when properties are omitted", () => {
    const items: ResolvedItem[] = [{ id: "v1", serviceId: "vpc", name: "v1", relationships: [] }];
    const graph = buildGraph(items, "Unit");
    expect(byId({ graph } as IacImportResult, "v1").config).toEqual({});
  });

  it("drops a parentId that points at the item's own id", () => {
    const items: ResolvedItem[] = [
      { id: "v1", serviceId: "vpc", name: "v1", parentId: "v1", relationships: [] },
    ];
    const graph = buildGraph(items, "Unit");
    expect(byId({ graph } as IacImportResult, "v1").parentId).toBeUndefined();
  });

  it("drops a relationship whose target is not in the item set", () => {
    const items: ResolvedItem[] = [
      {
        id: "v1",
        serviceId: "vpc",
        name: "v1",
        relationships: [{ to: "ghost", kind: "depends_on" }],
      },
    ];
    const graph = buildGraph(items, "Unit");
    expect(graph.relationships).toEqual([]);
  });

  it("yields {} config for an unregistered serviceId even with properties", () => {
    const items: ResolvedItem[] = [
      {
        id: "x1",
        serviceId: "does-not-exist",
        name: "x1",
        properties: { cidr: "10.0.0.0/16" },
        relationships: [],
      },
    ];
    const graph = buildGraph(items, "Unit");
    expect(byId({ graph } as IacImportResult, "x1").config).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// Terraform planned_values + CloudFormation registry resolution
// ---------------------------------------------------------------------------

describe("importTerraform (planned_values)", () => {
  it("imports terraform planned_values.root_module", () => {
    const res = importTerraform({
      planned_values: {
        root_module: {
          resources: [
            { address: "aws_s3_bucket.b", type: "aws_s3_bucket", name: "b", values: { id: "b" } },
          ],
        },
      },
    });
    expect(res.format).toBe("terraform");
    expect(res.graph.resources).toHaveLength(1);
    expect(byId(res, "aws_s3_bucket.b").serviceId).toBe("s3-bucket");
  });
});

describe("registry CloudFormation resolution", () => {
  it("batch resolves from CloudFormation ComputeEnvironment", () => {
    expect(getServiceByCfnType("AWS::Batch::ComputeEnvironment")?.id).toBe("batch");
  });
});

describe("route53 record/zone split", () => {
  it("imports aws_route53_record as the route53-record service", () => {
    expect(TF_TYPE_TO_SERVICE_ID["aws_route53_record"]).toBe("route53-record");
    expect(TF_TYPE_TO_SERVICE_ID["aws_route53_zone"]).toBe("route53");
  });
  it("resolves AWS::Route53::RecordSet to route53-record via cfnType", () => {
    expect(getServiceByCfnType("AWS::Route53::RecordSet")?.id).toBe("route53-record");
  });
});
