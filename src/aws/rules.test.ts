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

  it("suggests an ALB->service SG rule using the service's guessed port", () => {
    const alb = res("elastic-load-balancer", { id: "alb", name: "web-lb" });
    const tg = res("target-group", { id: "tg" });
    const ecs = res("ecs-service", { id: "ecs", name: "api", config: { port: 8080 } });
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
});
