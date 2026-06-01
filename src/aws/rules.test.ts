import { describe, it, expect } from "vitest";
import { validateArchitecture, suggestRules, type ValidationResult } from "./rules";
import {
  emptyGraph,
  type InfrastructureGraph,
  type ResourceInstance,
  type Relationship,
} from "./model";
import type { RelationshipKind } from "./types";

// ---- fixture helpers -------------------------------------------------------

let seq = 0;
function res(serviceId: string, over: Partial<ResourceInstance> = {}): ResourceInstance {
  const id = over.id ?? `${serviceId}-${seq++}`;
  return {
    ...over,
    id,
    serviceId,
    name: over.name ?? id,
    config: over.config ?? {},
    source: over.source ?? "manual",
  };
}

function rel(
  from: string,
  to: string,
  kind: RelationshipKind,
  over: Partial<Relationship> = {},
): Relationship {
  return { id: over.id ?? `${from}->${to}:${kind}-${seq++}`, from, to, kind, ...over };
}

function graph(
  resources: ResourceInstance[],
  relationships: Relationship[] = [],
): InfrastructureGraph {
  return { ...emptyGraph(), resources, relationships };
}

function messages(results: ValidationResult[]): string[] {
  return results.map((r) => r.message);
}
function levels(results: ValidationResult[], level: ValidationResult["level"]): ValidationResult[] {
  return results.filter((r) => r.level === level);
}

describe("validateArchitecture", () => {
  it("returns no findings for an empty graph", () => {
    expect(validateArchitecture(emptyGraph())).toEqual([]);
  });

  it("accepts a valid VPC + public subnet + IGW + route table topology", () => {
    const vpc = res("vpc", { id: "vpc", config: { cidr: "10.0.0.0/16" } });
    const subnet = res("subnet-public", { id: "sn", config: { cidr: "10.0.1.0/24" } });
    const igw = res("internet-gateway", { id: "igw" });
    const rt = res("route-table", { id: "rt" });

    const g = graph(
      [vpc, subnet, igw, rt],
      [
        rel("vpc", "sn", "contains"),
        rel("igw", "vpc", "attached_to"),
        rel("rt", "sn", "attached_to"),
        rel("rt", "igw", "routes_to"),
      ],
    );

    const out = validateArchitecture(g);
    // No errors expected; this is the canonical happy-path public topology.
    expect(levels(out, "error")).toEqual([]);
    expect(out).toEqual([]);
  });

  it("accepts an explicit default route (destinationCidr 0.0.0.0/0) to the IGW", () => {
    const vpc = res("vpc", { id: "vpc", config: { cidr: "10.0.0.0/16" } });
    const subnet = res("subnet-public", { id: "sn", config: { cidr: "10.0.1.0/24" } });
    const igw = res("internet-gateway", { id: "igw" });
    const rt = res("route-table", { id: "rt" });
    const g = graph(
      [vpc, subnet, igw, rt],
      [
        rel("vpc", "sn", "contains"),
        rel("igw", "vpc", "attached_to"),
        rel("rt", "sn", "attached_to"),
        rel("rt", "igw", "routes_to", { destinationCidr: "0.0.0.0/0" }),
      ],
    );
    expect(validateArchitecture(g)).toEqual([]);
  });

  it("flags a public subnet whose only IGW route is prefix-specific (not a default route)", () => {
    const vpc = res("vpc", { id: "vpc", config: { cidr: "10.0.0.0/16" } });
    const subnet = res("subnet-public", { id: "sn", config: { cidr: "10.0.1.0/24" } });
    const igw = res("internet-gateway", { id: "igw" });
    const rt = res("route-table", { id: "rt" });
    const g = graph(
      [vpc, subnet, igw, rt],
      [
        rel("vpc", "sn", "contains"),
        rel("igw", "vpc", "attached_to"),
        rel("rt", "sn", "attached_to"),
        rel("rt", "igw", "routes_to", { destinationCidr: "192.168.0.0/16" }),
      ],
    );
    const out = validateArchitecture(g);
    expect(messages(out).some((m) => m.includes("routes to an Internet Gateway"))).toBe(true);
  });

  it("accepts the same topology when containment is expressed via parentId (imported graph)", () => {
    // Mirrors the happy-path topology, but the subnet is contained by the VPC
    // through parentId (how MCP/imported graphs model it) — no `contains` edge.
    const vpc = res("vpc", { id: "vpc", config: { cidr: "10.0.0.0/16" } });
    const subnet = res("subnet-public", {
      id: "sn",
      parentId: "vpc",
      config: { cidr: "10.0.1.0/24" },
    });
    const igw = res("internet-gateway", { id: "igw" });
    const rt = res("route-table", { id: "rt" });

    const g = graph(
      [vpc, subnet, igw, rt],
      [
        rel("igw", "vpc", "attached_to"),
        rel("rt", "sn", "attached_to"),
        rel("rt", "igw", "routes_to"),
      ],
    );

    const out = validateArchitecture(g);
    expect(levels(out, "error")).toEqual([]);
    expect(out).toEqual([]);
  });

  it("accepts the topology when the subnet→route-table attachment is the reverse edge direction", () => {
    // Importers/MCP may emit `subnet --attached_to--> rt` (outgoing) rather than
    // `rt --attached_to--> subnet`. The route-table resolution is direction-
    // agnostic, so this must not false-positive the IGW/route-table check.
    const vpc = res("vpc", { id: "vpc", config: { cidr: "10.0.0.0/16" } });
    const subnet = res("subnet-public", { id: "sn", config: { cidr: "10.0.1.0/24" } });
    const igw = res("internet-gateway", { id: "igw" });
    const rt = res("route-table", { id: "rt" });

    const g = graph(
      [vpc, subnet, igw, rt],
      [
        rel("vpc", "sn", "contains"),
        rel("igw", "vpc", "attached_to"),
        rel("sn", "rt", "attached_to"), // reverse direction
        rel("rt", "igw", "routes_to"),
      ],
    );

    const out = validateArchitecture(g);
    expect(
      messages(out).some((m) => m.includes("should have a Route Table that routes to an Internet")),
    ).toBe(false);
  });

  it("validates a subnet's CIDR is contained within its VPC", () => {
    const vpc = res("vpc", { id: "vpc", config: { cidr: "10.0.0.0/16" } });
    const subnet = res("subnet-private", { id: "sn", config: { cidr: "192.168.1.0/24" } });
    const g = graph([vpc, subnet], [rel("vpc", "sn", "contains")]);

    const out = validateArchitecture(g);
    expect(messages(out)).toContain("Subnet 192.168.1.0/24 is not inside VPC 10.0.0.0/16.");
  });

  it("does not flag CIDR containment when the subnet CIDR is inside the VPC", () => {
    const vpc = res("vpc", { id: "vpc", config: { cidr: "10.0.0.0/16" } });
    const subnet = res("subnet-private", { id: "sn", config: { cidr: "10.0.5.0/24" } });
    // private subnet, no NAT route -> we expect a warn about NAT, but no CIDR error
    const g = graph([vpc, subnet], [rel("vpc", "sn", "contains")]);
    const out = validateArchitecture(g);
    expect(messages(out).some((m) => m.includes("is not inside VPC"))).toBe(false);
  });

  it("errors when a subnet is not contained by a VPC", () => {
    const subnet = res("subnet-private", { id: "sn", name: "orphan-subnet" });
    const out = validateArchitecture(graph([subnet]));
    expect(messages(out)).toContain('Subnet "orphan-subnet" should be contained by a VPC.');
  });

  it("errors when a public subnet lacks a route table routing to an IGW", () => {
    const vpc = res("vpc", { id: "vpc" });
    const subnet = res("subnet-public", { id: "sn", name: "pub" });
    // contained by VPC but no route table / IGW route
    const out = validateArchitecture(graph([vpc, subnet], [rel("vpc", "sn", "contains")]));
    expect(messages(out)).toContain(
      'Public Subnet "pub" should have a Route Table that routes to an Internet Gateway.',
    );
    expect(levels(out, "error").length).toBeGreaterThan(0);
  });

  it("errors when an Internet Gateway is not attached to a VPC", () => {
    const igw = res("internet-gateway", { id: "igw", name: "gw" });
    const out = validateArchitecture(graph([igw]));
    expect(messages(out)).toContain('Internet Gateway "gw" must be attached to a VPC.');
  });

  it("warns when a route table is not attached to any subnet", () => {
    const rt = res("route-table", { id: "rt", name: "rtb" });
    const out = validateArchitecture(graph([rt]));
    expect(messages(out)).toContain('Route Table "rtb" is not attached to any Subnet.');
    expect(levels(out, "warn").length).toBeGreaterThan(0);
  });

  it("errors when a NAT Gateway is not placed in a public subnet", () => {
    const priv = res("subnet-private", { id: "sn" });
    const nat = res("nat-gateway", { id: "nat", name: "nat" });
    // NAT attached to a private subnet -> should be flagged
    const out = validateArchitecture(graph([priv, nat], [rel("nat", "sn", "attached_to")]));
    expect(messages(out)).toContain('NAT Gateway "nat" should be placed in a public Subnet.');
  });

  it("does not flag a NAT Gateway placed in a public subnet", () => {
    const pub = res("subnet-public", { id: "sn" });
    const nat = res("nat-gateway", { id: "nat", name: "nat" });
    const out = validateArchitecture(graph([pub, nat], [rel("nat", "sn", "attached_to")]));
    expect(messages(out).some((m) => m.includes("NAT Gateway"))).toBe(false);
  });

  it("warns when a private subnet lacks a route to a NAT Gateway", () => {
    const vpc = res("vpc", { id: "vpc" });
    const priv = res("subnet-private", { id: "sn", name: "priv" });
    const out = validateArchitecture(graph([vpc, priv], [rel("vpc", "sn", "contains")]));
    expect(messages(out)).toContain(
      'Private Subnet "priv" usually needs a Route Table that routes to a NAT Gateway for egress.',
    );
  });

  it("does not warn when a private subnet routes to a NAT Gateway", () => {
    const vpc = res("vpc", { id: "vpc" });
    const priv = res("subnet-private", { id: "sn", name: "priv" });
    const pub = res("subnet-public", { id: "pubsn" });
    const rt = res("route-table", { id: "rt" });
    const nat = res("nat-gateway", { id: "nat" });
    const out = validateArchitecture(
      graph(
        [vpc, priv, pub, rt, nat],
        [
          rel("vpc", "sn", "contains"),
          rel("rt", "sn", "attached_to"),
          rel("rt", "nat", "routes_to"),
          rel("nat", "pubsn", "attached_to"),
        ],
      ),
    );
    expect(messages(out).some((m) => m.includes("NAT Gateway for egress"))).toBe(false);
  });

  describe("load balancer", () => {
    it("warns when an ALB is not in a public subnet and has no target group", () => {
      const alb = res("elastic-load-balancer", { id: "alb", name: "lb" });
      const out = validateArchitecture(graph([alb]));
      expect(messages(out)).toContain('Load Balancer "lb" is not placed in any public Subnet.');
      expect(messages(out)).toContain('Load Balancer "lb" should target a Target Group.');
    });

    it("errors when an ALB has public Subnets in only one Availability Zone", () => {
      const pub = res("subnet-public", { id: "sn", config: { az: "us-east-1a" } });
      const alb = res("elastic-load-balancer", { id: "alb", name: "lb" });
      const tg = res("target-group", { id: "tg" });
      const ec2 = res("ec2-instance", { id: "ec2" });
      const out = validateArchitecture(
        graph(
          [pub, alb, tg, ec2],
          [
            rel("alb", "sn", "attached_to"),
            rel("alb", "tg", "targets"),
            rel("tg", "ec2", "targets"),
          ],
        ),
      );
      expect(messages(out)).toContain(
        'Load Balancer "lb" must have public Subnets in at least 2 Availability Zones.',
      );
      expect(levels(out, "error").length).toBeGreaterThan(0);
    });

    it("does not flag an ALB with public Subnets across two AZs and a target group", () => {
      const pubA = res("subnet-public", { id: "snA", config: { az: "us-east-1a" } });
      const pubB = res("subnet-public", { id: "snB", config: { az: "us-east-1b" } });
      const alb = res("elastic-load-balancer", { id: "alb", name: "lb" });
      const tg = res("target-group", { id: "tg" });
      const ec2 = res("ec2-instance", { id: "ec2" });
      const out = validateArchitecture(
        graph(
          [pubA, pubB, alb, tg, ec2],
          [
            rel("alb", "snA", "attached_to"),
            rel("alb", "snB", "attached_to"),
            rel("alb", "tg", "targets"),
            rel("tg", "ec2", "targets"),
          ],
        ),
      );
      const albMsgs = messages(out).filter((m) => m.includes("Load Balancer"));
      expect(albMsgs).toEqual([]);
    });
  });

  describe("target group", () => {
    it("warns when a target group has no compute target", () => {
      const tg = res("target-group", { id: "tg", name: "tg-web" });
      const out = validateArchitecture(graph([tg]));
      expect(messages(out)).toContain(
        'Target Group "tg-web" should target a compute target (ECS Service, EC2 instance, Lambda, or an ALB).',
      );
    });

    it("does not warn when a target group targets an EC2 instance", () => {
      const tg = res("target-group", { id: "tg", name: "tg-web" });
      const ec2 = res("ec2-instance", { id: "ec2" });
      const out = validateArchitecture(graph([tg, ec2], [rel("tg", "ec2", "targets")]));
      expect(messages(out).some((m) => m.includes("Target Group"))).toBe(false);
    });

    it("does not warn when a target group targets a Lambda function", () => {
      const tg = res("target-group", { id: "tg", name: "tg-fn" });
      const fn = res("lambda", { id: "fn" });
      const out = validateArchitecture(graph([tg, fn], [rel("tg", "fn", "targets")]));
      expect(messages(out).some((m) => m.includes("Target Group"))).toBe(false);
    });

    it("does not warn when a target group chains to another load balancer", () => {
      const tg = res("target-group", { id: "tg", name: "tg-alb" });
      const alb = res("elastic-load-balancer", { id: "alb2" });
      const out = validateArchitecture(graph([tg, alb], [rel("tg", "alb2", "targets")]));
      // The target group itself is satisfied (ALB is a valid chained target);
      // any other "Target Group" text comes from alb2's own missing-TG warning.
      expect(messages(out).some((m) => m.startsWith("Target Group"))).toBe(false);
    });
  });

  describe("ECS service", () => {
    it("errors when an ECS service has no subnet and no security group", () => {
      const svc = res("ecs-service", { id: "svc", name: "api" });
      const out = validateArchitecture(graph([svc]));
      expect(messages(out)).toContain('ECS Service "api" must be attached to Subnet(s).');
      expect(messages(out)).toContain('ECS Service "api" should be attached to a Security Group.');
    });

    it("is clean when an ECS service is attached to a subnet and a security group", () => {
      const svc = res("ecs-service", { id: "svc", name: "api" });
      const sn = res("subnet-private", { id: "sn" });
      const sg = res("security-group", { id: "sg" });
      const vpc = res("vpc", { id: "vpc" });
      const rt = res("route-table", { id: "rt" });
      const nat = res("nat-gateway", { id: "nat" });
      const pub = res("subnet-public", { id: "pubsn" });
      const out = validateArchitecture(
        graph(
          [svc, sn, sg, vpc, rt, nat, pub],
          [
            rel("sn", "svc", "attached_to"),
            rel("sg", "svc", "attached_to"),
            rel("vpc", "sn", "contains"),
            rel("rt", "sn", "attached_to"),
            rel("rt", "nat", "routes_to"),
            rel("nat", "pubsn", "attached_to"),
          ],
        ),
      );
      expect(messages(out).some((m) => m.includes("ECS Service"))).toBe(false);
    });
  });

  describe("RDS", () => {
    it("warns when RDS sits in a public subnet", () => {
      const rds = res("rds", { id: "rds", name: "db" });
      const pub = res("subnet-public", { id: "sn", name: "pub" });
      const sg = res("security-group", { id: "sg" });
      const out = validateArchitecture(
        graph([rds, pub, sg], [rel("sn", "rds", "attached_to"), rel("sg", "rds", "attached_to")]),
      );
      expect(messages(out)).toContain('RDS "db" should not be in public Subnet "pub".');
    });

    it("warns when RDS has no subnet and no security group", () => {
      const rds = res("rds", { id: "rds", name: "db" });
      const out = validateArchitecture(graph([rds]));
      expect(messages(out)).toContain('RDS "db" should be attached to private Subnet(s).');
      expect(messages(out)).toContain('RDS "db" should be attached to a Security Group.');
    });

    it("is clean for RDS in a private subnet with a security group", () => {
      const rds = res("rds", { id: "rds", name: "db" });
      const priv = res("subnet-private", { id: "sn" });
      const sg = res("security-group", { id: "sg" });
      const out = validateArchitecture(
        graph([rds, priv, sg], [rel("sn", "rds", "attached_to"), rel("sg", "rds", "attached_to")]),
      );
      expect(messages(out).some((m) => m.includes("RDS"))).toBe(false);
    });
  });

  describe("NACL", () => {
    it("warns when a NACL is not attached to any subnet", () => {
      const nacl = res("nacl", { id: "nacl", name: "acl" });
      const out = validateArchitecture(graph([nacl]));
      expect(messages(out)).toContain('NACL "acl" is not attached to any Subnet.');
      expect(levels(out, "warn").length).toBeGreaterThan(0);
    });

    it("does not warn when a NACL is attached to a subnet", () => {
      const nacl = res("nacl", { id: "nacl", name: "acl" });
      const sn = res("subnet-public", { id: "sn" });
      const out = validateArchitecture(graph([nacl, sn], [rel("nacl", "sn", "attached_to")]));
      expect(messages(out).some((m) => m.includes("NACL"))).toBe(false);
    });
  });

  describe("parentId-based containment (no false positives)", () => {
    it("treats a subnet contained by a VPC via parentId as contained", () => {
      const vpc = res("vpc", { id: "vpc", config: { cidr: "10.0.0.0/16" } });
      const sn = res("subnet-private", {
        id: "sn",
        name: "priv",
        parentId: "vpc",
        config: { cidr: "10.0.5.0/24" },
      });
      const out = validateArchitecture(graph([vpc, sn]));
      // No edges at all — containment is via parentId only.
      expect(messages(out).some((m) => m.includes("should be contained by a VPC"))).toBe(false);
      expect(messages(out).some((m) => m.includes("is not inside VPC"))).toBe(false);
    });

    it("does not falsely flag ECS placement when subnet/SG are via parentId/edges", () => {
      const vpc = res("vpc", { id: "vpc" });
      const priv = res("subnet-private", { id: "sn", parentId: "vpc" });
      const sg = res("security-group", { id: "sg" });
      const rt = res("route-table", { id: "rt" });
      const nat = res("nat-gateway", { id: "nat", parentId: "pubsn" });
      const pub = res("subnet-public", { id: "pubsn", parentId: "vpc" });
      // ECS service placed in the private subnet via parentId.
      const svc = res("ecs-service", { id: "svc", name: "api", parentId: "sn" });
      const out = validateArchitecture(
        graph(
          [vpc, priv, sg, rt, nat, pub, svc],
          [
            rel("sg", "svc", "attached_to"),
            rel("rt", "sn", "attached_to"),
            rel("rt", "nat", "routes_to"),
          ],
        ),
      );
      expect(messages(out).some((m) => m.includes("ECS Service"))).toBe(false);
    });

    it("does not falsely flag RDS placement when subnet is via parentId", () => {
      const vpc = res("vpc", { id: "vpc" });
      const priv = res("subnet-private", { id: "sn", parentId: "vpc" });
      const sg = res("security-group", { id: "sg" });
      const rds = res("rds", { id: "rds", name: "db", parentId: "sn" });
      const out = validateArchitecture(
        graph([vpc, priv, sg, rds], [rel("sg", "rds", "attached_to")]),
      );
      expect(messages(out).some((m) => m.includes("RDS"))).toBe(false);
    });

    it("treats a NAT Gateway placed in a public subnet via parentId as valid", () => {
      const pub = res("subnet-public", { id: "sn" });
      const nat = res("nat-gateway", { id: "nat", name: "nat", parentId: "sn" });
      const out = validateArchitecture(graph([pub, nat]));
      expect(messages(out).some((m) => m.includes("NAT Gateway"))).toBe(false);
    });
  });

  describe("subnet containment via the 'contains' edge direction", () => {
    it("accepts vpc --contains--> subnet (parent -> child)", () => {
      const vpc = res("vpc", { id: "vpc", config: { cidr: "10.0.0.0/16" } });
      const sn = res("subnet-private", { id: "sn", config: { cidr: "10.0.7.0/24" } });
      const out = validateArchitecture(graph([vpc, sn], [rel("vpc", "sn", "contains")]));
      expect(messages(out).some((m) => m.includes("should be contained by a VPC"))).toBe(false);
    });

    it("ignores a 'contains' edge to a non-VPC and still flags the subnet", () => {
      // A contains edge from a non-VPC must not satisfy VPC containment, and a
      // wrong-kind edge to the VPC must not either.
      const notVpc = res("route-table", { id: "rt" });
      const vpc = res("vpc", { id: "vpc" });
      const sn = res("subnet-private", { id: "sn", name: "orphan" });
      const out = validateArchitecture(
        graph([notVpc, vpc, sn], [rel("rt", "sn", "contains"), rel("vpc", "sn", "routes_to")]),
      );
      expect(messages(out)).toContain('Subnet "orphan" should be contained by a VPC.');
    });
  });

  describe("attachment checks accept either edge direction", () => {
    it("does not flag a route table attached via the reverse subnet->rt edge", () => {
      const rt = res("route-table", { id: "rt", name: "rtb" });
      const sn = res("subnet-public", { id: "sn" });
      const out = validateArchitecture(graph([rt, sn], [rel("sn", "rt", "attached_to")]));
      expect(messages(out).some((m) => m.includes("is not attached to any Subnet"))).toBe(false);
    });

    it("does not flag a NACL attached via the reverse subnet->nacl edge", () => {
      const nacl = res("nacl", { id: "nacl", name: "acl" });
      const sn = res("subnet-public", { id: "sn" });
      const out = validateArchitecture(graph([nacl, sn], [rel("sn", "nacl", "attached_to")]));
      expect(messages(out).some((m) => m.includes('NACL "acl" is not attached'))).toBe(false);
    });

    it("does not flag an IGW attached via the reverse vpc->igw edge", () => {
      const igw = res("internet-gateway", { id: "igw", name: "gw" });
      const vpc = res("vpc", { id: "vpc" });
      const out = validateArchitecture(graph([igw, vpc], [rel("vpc", "igw", "attached_to")]));
      expect(messages(out).some((m) => m.includes("must be attached to a VPC"))).toBe(false);
    });
  });

  describe("S3 Block Public Access", () => {
    it("warns when Block Public Access is explicitly disabled", () => {
      const b = res("s3-bucket", { id: "b", name: "data", config: { blockPublicAccess: false } });
      const out = validateArchitecture(graph([b]));
      expect(messages(out)).toContain(
        'S3 bucket "data" has Block Public Access disabled; the bucket may be publicly accessible.',
      );
    });

    it("does not warn when Block Public Access is unset (defaults on)", () => {
      const b = res("s3-bucket", { id: "b", name: "data" });
      const out = validateArchitecture(graph([b]));
      expect(messages(out).some((m) => m.includes("Block Public Access"))).toBe(false);
    });
  });

  describe("RDS public access + encryption", () => {
    it("errors when RDS is publicly accessible", () => {
      const rds = res("rds", {
        id: "rds",
        name: "db",
        parentId: "sn",
        config: { publiclyAccessible: true },
      });
      const priv = res("subnet-private", { id: "sn" });
      const sg = res("security-group", { id: "sg" });
      const out = validateArchitecture(graph([rds, priv, sg], [rel("sg", "rds", "attached_to")]));
      const finding = out.find((r) => r.message === 'RDS "db" must not be publicly accessible.');
      expect(finding).toBeDefined();
      expect(finding!.level).toBe("error");
    });

    it("warns when RDS storage encryption is explicitly disabled", () => {
      const rds = res("rds", {
        id: "rds",
        name: "db",
        parentId: "sn",
        config: { storageEncrypted: false },
      });
      const priv = res("subnet-private", { id: "sn" });
      const sg = res("security-group", { id: "sg" });
      const out = validateArchitecture(graph([rds, priv, sg], [rel("sg", "rds", "attached_to")]));
      const finding = out.filter(
        (r) => r.message === "db stores data at rest unencrypted; enable encryption.",
      );
      // Implemented via the shared encryption-at-rest pass; must fire exactly once.
      expect(finding).toHaveLength(1);
      expect(finding[0].level).toBe("warn");
    });
  });

  describe("RDS public-subnet placement severity", () => {
    it("flags RDS in a public subnet at error level", () => {
      const rds = res("rds", { id: "rds", name: "db" });
      const pub = res("subnet-public", { id: "sn", name: "pub" });
      const sg = res("security-group", { id: "sg" });
      const out = validateArchitecture(
        graph([rds, pub, sg], [rel("sn", "rds", "attached_to"), rel("sg", "rds", "attached_to")]),
      );
      const finding = out.find(
        (r) => r.message === 'RDS "db" should not be in public Subnet "pub".',
      );
      expect(finding).toBeDefined();
      expect(finding!.level).toBe("error");
    });
  });

  describe("encryption at rest", () => {
    it("warns for an EBS volume with encryption disabled", () => {
      const vol = res("ebs-volume", { id: "v", name: "vol", config: { encrypted: false } });
      const out = validateArchitecture(graph([vol]));
      expect(messages(out)).toContain("vol stores data at rest unencrypted; enable encryption.");
    });

    it("does not warn for an EBS volume with encryption unset", () => {
      const vol = res("ebs-volume", { id: "v", name: "vol" });
      const out = validateArchitecture(graph([vol]));
      expect(messages(out).some((m) => m.includes("stores data at rest"))).toBe(false);
    });
  });

  describe("security group open sensitive ports", () => {
    it("warns when SSH (22) is open to the world", () => {
      const sg = res("security-group", {
        id: "sg",
        name: "web",
        config: { ingress: "tcp 22 0.0.0.0/0" },
      });
      const out = validateArchitecture(graph([sg]));
      expect(messages(out)).toContain(
        'Security Group "web" exposes sensitive port 22 to the world (0.0.0.0/0).',
      );
    });

    it("does not warn for HTTPS (443) open to the world", () => {
      const sg = res("security-group", {
        id: "sg",
        name: "web",
        config: { ingress: "tcp 443 0.0.0.0/0" },
      });
      const out = validateArchitecture(graph([sg]));
      expect(messages(out).some((m) => m.includes("exposes sensitive port"))).toBe(false);
    });

    it("does not warn when SSH is restricted to a private CIDR", () => {
      const sg = res("security-group", {
        id: "sg",
        name: "web",
        config: { ingress: "tcp 22 10.0.0.0/8" },
      });
      const out = validateArchitecture(graph([sg]));
      expect(messages(out).some((m) => m.includes("exposes sensitive port"))).toBe(false);
    });
  });

  describe("GCP/Azure provider checks", () => {
    it("warns when GCP Cloud Storage has uniform bucket-level access disabled", () => {
      const b = res("gcp-cloud-storage", {
        id: "b",
        name: "bucket",
        config: { uniformBucketLevelAccess: false },
      });
      const out = validateArchitecture(graph([b]));
      expect(messages(out).some((m) => m.includes("uniform bucket-level access disabled"))).toBe(
        true,
      );
    });

    it("warns when a GCP firewall rule opens a sensitive port to the world", () => {
      const fw = res("gcp-firewall-rule", {
        id: "fw",
        name: "allow-ssh",
        config: { sourceRanges: "0.0.0.0/0", allowed: "tcp:22" },
      });
      const out = validateArchitecture(graph([fw]));
      expect(messages(out)).toContain(
        'Firewall rule "allow-ssh" exposes sensitive port 22 to the world (0.0.0.0/0).',
      );
    });

    it("warns when an Azure Storage Account allows public blob access", () => {
      const sa = res("azure-storage-account", {
        id: "sa",
        name: "store",
        config: { allowPublicAccess: true },
      });
      const out = validateArchitecture(graph([sa]));
      expect(messages(out)).toContain('Storage Account "store" has public blob access enabled.');
    });

    it("warns when Azure Redis has the non-SSL port enabled", () => {
      const redis = res("azure-redis", {
        id: "r",
        name: "cache",
        config: { enableNonSslPort: true },
      });
      const out = validateArchitecture(graph([redis]));
      expect(messages(out)).toContain('Redis "cache" has the non-SSL port enabled.');
    });
  });
});

describe("suggestRules", () => {
  it("returns no suggestions for an empty graph", () => {
    expect(suggestRules(emptyGraph())).toEqual([]);
  });

  it("suggests a public ingress SG rule for an ALB", () => {
    const alb = res("elastic-load-balancer", { id: "alb", name: "web-lb" });
    const out = suggestRules(graph([alb]));
    const albRule = out.find((s) => s.scope === "web-lb" && s.type === "Security Group");
    expect(albRule).toBeDefined();
    expect(albRule!.rules[0]).toMatchObject({
      dir: "ingress",
      proto: "tcp",
      port: "80,443",
      src: "0.0.0.0/0",
    });
  });

  it("suggests an ALB->service SG rule using the target group's port", () => {
    const alb = res("elastic-load-balancer", { id: "alb", name: "web-lb" });
    const tg = res("target-group", { id: "tg", config: { port: 8080 } });
    const ecs = res("ecs-service", { id: "ecs", name: "api" });
    const sg = res("security-group", { id: "sg", name: "api-sg" });
    const out = suggestRules(
      graph(
        [alb, tg, ecs, sg],
        [rel("alb", "tg", "targets"), rel("tg", "ecs", "targets"), rel("sg", "ecs", "attached_to")],
      ),
    );
    const svcRule = out.find((s) => s.scope === "api-sg");
    expect(svcRule).toBeDefined();
    expect(svcRule!.rules[0]).toMatchObject({
      dir: "ingress",
      proto: "tcp",
      port: "8080",
      src: "sg:web-lb",
      comment: "ALB to Service",
    });
  });

  it("falls back to port 80 when the service has no port config", () => {
    const alb = res("elastic-load-balancer", { id: "alb", name: "lb" });
    const tg = res("target-group", { id: "tg" });
    const ec2 = res("ec2-instance", { id: "ec2", name: "app" });
    const sg = res("security-group", { id: "sg", name: "app-sg" });
    const out = suggestRules(
      graph(
        [alb, tg, ec2, sg],
        [rel("alb", "tg", "targets"), rel("tg", "ec2", "targets"), rel("sg", "ec2", "attached_to")],
      ),
    );
    const svcRule = out.find((s) => s.scope === "app-sg");
    expect(svcRule!.rules[0]).toMatchObject({ port: "80" });
  });

  it("suggests a NAT route table for a private subnet", () => {
    const sn = res("subnet-private", { id: "sn", name: "priv-a" });
    const out = suggestRules(graph([sn]));
    const rule = out.find((s) => s.scope === "priv-a" && s.type === "Route Table");
    expect(rule).toBeDefined();
    expect(rule!.rules[0]).toMatchObject({ route: "0.0.0.0/0", target: "NAT Gateway" });
  });

  it("suggests an IGW route table for a public subnet", () => {
    const sn = res("subnet-public", { id: "sn", name: "pub-a" });
    const out = suggestRules(graph([sn]));
    const rule = out.find((s) => s.scope === "pub-a" && s.type === "Route Table");
    expect(rule).toBeDefined();
    expect(rule!.rules[0]).toMatchObject({ route: "0.0.0.0/0", target: "Internet Gateway" });
  });

  it("suggests baseline NACL ingress/egress rules for a NACL", () => {
    const nacl = res("nacl", { id: "nacl", name: "web-acl" });
    const out = suggestRules(graph([nacl]));
    const rule = out.find((s) => s.scope === "web-acl" && s.type === "NACL");
    expect(rule).toBeDefined();
    expect(rule!.rules).toHaveLength(2);
    expect(rule!.rules[0]).toMatchObject({
      num: 100,
      dir: "ingress",
      proto: "tcp",
      port: "1024-65535",
      allow: true,
    });
    expect(rule!.rules[1]).toMatchObject({ num: 110, dir: "egress", allow: true });
  });

  it("does not emit an ALB->service rule when the service has no security group", () => {
    const alb = res("elastic-load-balancer", { id: "alb", name: "lb" });
    const tg = res("target-group", { id: "tg" });
    const ec2 = res("ec2-instance", { id: "ec2", name: "app" });
    const out = suggestRules(
      graph([alb, tg, ec2], [rel("alb", "tg", "targets"), rel("tg", "ec2", "targets")]),
    );
    // Only the ALB public-ingress suggestion, nothing scoped to a service SG.
    expect(out.filter((s) => s.type === "Security Group")).toHaveLength(1);
    expect(out.some((s) => s.rules.some((r) => r.comment === "ALB to Service"))).toBe(false);
  });

  it("suggests an App->DB ingress rule with the engine port and the app SG as source", () => {
    const alb = res("elastic-load-balancer", { id: "alb", name: "lb" });
    const tg = res("target-group", { id: "tg" });
    const ecs = res("ecs-service", { id: "ecs", name: "api" });
    const appSg = res("security-group", { id: "appsg", name: "app-sg" });
    const dbSg = res("security-group", { id: "dbsg", name: "db-sg" });
    const rds = res("rds", { id: "rds", name: "db", config: { engine: "postgres" } });
    const out = suggestRules(
      graph(
        [alb, tg, ecs, appSg, dbSg, rds],
        [
          rel("alb", "tg", "targets"),
          rel("tg", "ecs", "targets"),
          rel("appsg", "ecs", "attached_to"),
          rel("dbsg", "rds", "attached_to"),
        ],
      ),
    );
    const dbRule = out.find((s) => s.scope === "db-sg" && s.type === "Security Group");
    expect(dbRule).toBeDefined();
    expect(dbRule!.rules[0]).toMatchObject({
      dir: "ingress",
      proto: "tcp",
      port: 5432,
      src: "sg:app-sg",
      comment: "App to DB",
    });
  });

  it("does not suggest a route table when the subnet is already wired to its gateway", () => {
    const priv = res("subnet-private", { id: "sn", name: "priv" });
    const rt = res("route-table", { id: "rt" });
    const nat = res("nat-gateway", { id: "nat" });
    const out = suggestRules(
      graph([priv, rt, nat], [rel("rt", "sn", "attached_to"), rel("rt", "nat", "routes_to")]),
    );
    expect(out.some((s) => s.type === "Route Table")).toBe(false);
  });

  it("still suggests a route table for an unwired subnet", () => {
    const priv = res("subnet-private", { id: "sn", name: "priv" });
    const out = suggestRules(graph([priv]));
    expect(out.some((s) => s.type === "Route Table" && s.scope === "priv")).toBe(true);
  });

  it("returns no suggestions for an all-GCP graph", () => {
    const g = graph([
      res("gcp-vpc-network", { id: "vpc" }),
      res("gcp-cloud-storage", { id: "b" }),
      res("gcp-firewall-rule", { id: "fw" }),
    ]);
    expect(suggestRules(g)).toEqual([]);
  });

  it("returns no suggestions for an all-Azure graph", () => {
    const g = graph([res("azure-storage-account", { id: "sa" }), res("azure-redis", { id: "r" })]);
    expect(suggestRules(g)).toEqual([]);
  });
});

describe("validateArchitecture — findings carry resourceId", () => {
  it("attaches the offending resource id so the UI can badge that node", () => {
    const sn = res("subnet-public", { id: "sn", config: { cidr: "10.0.1.0/24" } });
    const out = validateArchitecture(graph([sn]));
    const f = out.find((r) => r.message.includes("should be contained by a VPC"));
    expect(f).toBeDefined();
    expect(f!.resourceId).toBe("sn");
  });

  it("flags a public S3 bucket against the bucket's id", () => {
    const b = res("s3-bucket", { id: "bkt", config: { blockPublicAccess: false } });
    const out = validateArchitecture(graph([b]));
    const f = out.find((r) => r.message.includes("Block Public Access disabled"));
    expect(f?.resourceId).toBe("bkt");
  });
});

describe("validateArchitecture — Well-Architected checks", () => {
  const has = (out: ValidationResult[], needle: string) =>
    out.some((r) => r.message.includes(needle));

  it("flags config-driven anti-patterns only on explicit bad values", () => {
    const ddb = res("dynamodb", { id: "d", config: { pointInTimeRecovery: false } });
    const ec2 = res("ec2-instance", { id: "e", config: { metadataHttpTokens: "optional" } });
    const alb = res("elastic-load-balancer", { id: "a", config: { listenerProtocol: "HTTP" } });
    const sql = res("gcp-cloud-sql", { id: "g", config: { ipv4Enabled: true } });
    const out = validateArchitecture(graph([ddb, ec2, alb, sql]));
    expect(has(out, "point-in-time recovery disabled")).toBe(true);
    expect(has(out, "IMDSv1")).toBe(true);
    expect(has(out, "unencrypted HTTP listener")).toBe(true);
    expect(has(out, "public IP")).toBe(true);
    // resourceId attached for badging.
    expect(out.find((r) => r.message.includes("IMDSv1"))!.resourceId).toBe("e");
  });

  it("does not fire on secure defaults / absent config", () => {
    const ddb = res("dynamodb", { config: { pointInTimeRecovery: true } });
    const ec2 = res("ec2-instance", { config: {} }); // no metadataHttpTokens key
    const out = validateArchitecture(graph([ddb, ec2]));
    expect(has(out, "point-in-time")).toBe(false);
    expect(has(out, "IMDSv1")).toBe(false);
  });

  it("flags an idle (unattached) EBS volume", () => {
    const v = res("ebs-volume", { id: "v" });
    const out = validateArchitecture(graph([v]));
    expect(has(out, "not attached to an instance")).toBe(true);
  });

  it("flags a single NAT Gateway serving private subnets in multiple AZs", () => {
    const vpc = res("vpc", { id: "vpc", config: { cidr: "10.0.0.0/16" } });
    const a = res("subnet-private", {
      id: "a",
      parentId: "vpc",
      config: { cidr: "10.0.1.0/24", az: "us-east-1a" },
    });
    const b = res("subnet-private", {
      id: "b",
      parentId: "vpc",
      config: { cidr: "10.0.2.0/24", az: "us-east-1b" },
    });
    const nat = res("nat-gateway", { id: "nat" });
    const out = validateArchitecture(graph([vpc, a, b, nat]));
    expect(has(out, "NAT Gateway per AZ")).toBe(true);
  });

  it("flags CloudFront without a WAF, but not when one is attached", () => {
    const cf = res("cloudfront", { id: "cf" });
    expect(has(validateArchitecture(graph([cf])), "no WAF attached")).toBe(true);
    const waf = res("waf", { id: "w" });
    const withWaf = validateArchitecture(graph([cf, waf], [rel("w", "cf", "attached_to")]));
    expect(has(withWaf, "no WAF attached")).toBe(false);
  });
});
