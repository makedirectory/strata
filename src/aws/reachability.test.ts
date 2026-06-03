import { describe, it, expect } from "vitest";
import {
  evaluateReachability,
  litReachable,
  isWorldCidr,
  type OpenPort,
} from "./reachability";
import { emptyGraph, type InfrastructureGraph, type ResourceInstance, type Relationship } from "./model";

let seq = 0;
function res(
  serviceId: string,
  name: string,
  extra: Partial<ResourceInstance> = {},
): ResourceInstance {
  return {
    id: `${serviceId}-${name}-${seq++}`,
    serviceId,
    name,
    config: {},
    source: "manual",
    ...extra,
  };
}

function rel(
  from: string,
  to: string,
  kind: Relationship["kind"],
  extra: Partial<Relationship> = {},
): Relationship {
  return { id: `rel-${seq++}`, from, to, kind, ...extra };
}

function graphOf(
  resources: ResourceInstance[],
  relationships: Relationship[] = [],
): InfrastructureGraph {
  return { ...emptyGraph("test"), resources, relationships };
}

describe("isWorldCidr", () => {
  it("matches IPv4 and IPv6 any-address", () => {
    expect(isWorldCidr("0.0.0.0/0")).toBe(true);
    expect(isWorldCidr("::/0")).toBe(true);
    expect(isWorldCidr(" 0.0.0.0/0 ")).toBe(true);
  });
  it("rejects prefix-specific and malformed CIDRs", () => {
    expect(isWorldCidr("10.0.0.0/8")).toBe(false);
    expect(isWorldCidr("0.0.0.0/24")).toBe(false);
    expect(isWorldCidr("not-a-cidr")).toBe(false);
    expect(isWorldCidr("0.0.0.0")).toBe(false);
    // network bits must be zero for a /0
    expect(isWorldCidr("1.2.3.4/0")).toBe(true); // /0 zeroes the net regardless
  });
});

describe("evaluateReachability — edge services", () => {
  it("marks an internet gateway and a fronted resource exposed", () => {
    const igw = res("internet-gateway", "igw");
    const lambda = res("lambda", "fn");
    const g = graphOf([igw, lambda], [rel(igw.id, lambda.id, "connects_to")]);
    const r = evaluateReachability(g);
    expect(r.internetReachableIds.has(igw.id)).toBe(true);
    expect(r.internetReachableIds.has(lambda.id)).toBe(true);
    const exposedFn = r.exposed.find((e) => e.resourceId === lambda.id);
    expect(exposedFn?.via.some((v) => v.includes("fronted by"))).toBe(true);
  });

  it("treats an internal load balancer as NOT an edge", () => {
    const albInternal = res("elastic-load-balancer", "alb", { config: { scheme: "internal" } });
    const g = graphOf([albInternal]);
    const r = evaluateReachability(g);
    expect(r.internetReachableIds.has(albInternal.id)).toBe(false);
    expect(r.exposed).toHaveLength(0);
  });

  it("treats a default (internet-facing) load balancer as an edge", () => {
    const alb = res("elastic-load-balancer", "alb");
    const g = graphOf([alb]);
    const r = evaluateReachability(g);
    expect(r.internetReachableIds.has(alb.id)).toBe(true);
  });
});

describe("evaluateReachability — public subnet routing", () => {
  function buildPublicSubnetGraph(routed: boolean) {
    const vpc = res("vpc", "vpc", { config: { cidr: "10.0.0.0/16" } });
    const igw = res("internet-gateway", "igw");
    const subnet = res("subnet-public", "pub", { parentId: vpc.id });
    const rt = res("route-table", "rt");
    const ec2 = res("ec2-instance", "web", { parentId: subnet.id });
    const rels: Relationship[] = [
      rel(igw.id, vpc.id, "attached_to"),
      rel(rt.id, subnet.id, "attached_to"),
    ];
    if (routed) rels.push(rel(rt.id, igw.id, "routes_to", { destinationCidr: "0.0.0.0/0" }));
    return graphOf([vpc, igw, subnet, rt, ec2], rels);
  }

  it("marks a resource in a routed public subnet exposed", () => {
    const g = buildPublicSubnetGraph(true);
    const r = evaluateReachability(g);
    const ec2 = g.resources.find((x) => x.serviceId === "ec2-instance")!;
    expect(r.internetReachableIds.has(ec2.id)).toBe(true);
    expect(r.publicSubnetIds.size).toBe(1);
  });

  it("does NOT mark exposed when the public subnet lacks a default route", () => {
    const g = buildPublicSubnetGraph(false);
    const r = evaluateReachability(g);
    const ec2 = g.resources.find((x) => x.serviceId === "ec2-instance")!;
    expect(r.internetReachableIds.has(ec2.id)).toBe(false);
    expect(r.notes.some((n) => n.includes("no default route"))).toBe(true);
  });

  it("treats a prefix-specific route as NOT a default route", () => {
    const vpc = res("vpc", "vpc");
    const igw = res("internet-gateway", "igw");
    const subnet = res("subnet-public", "pub", { parentId: vpc.id });
    const rt = res("route-table", "rt");
    const ec2 = res("ec2-instance", "web", { parentId: subnet.id });
    const g = graphOf(
      [vpc, igw, subnet, rt, ec2],
      [
        rel(rt.id, subnet.id, "attached_to"),
        rel(rt.id, igw.id, "routes_to", { destinationCidr: "192.168.0.0/16" }),
      ],
    );
    const r = evaluateReachability(g);
    expect(r.internetReachableIds.has(ec2.id)).toBe(false);
  });

  it("treats an unspecified route destination as a default route (back-compat)", () => {
    const vpc = res("vpc", "vpc");
    const igw = res("internet-gateway", "igw");
    const subnet = res("subnet-public", "pub", { parentId: vpc.id });
    const rt = res("route-table", "rt");
    const ec2 = res("ec2-instance", "web", { parentId: subnet.id });
    const g = graphOf(
      [vpc, igw, subnet, rt, ec2],
      [rel(rt.id, subnet.id, "attached_to"), rel(rt.id, igw.id, "routes_to")],
    );
    const r = evaluateReachability(g);
    expect(r.internetReachableIds.has(ec2.id)).toBe(true);
  });
});

describe("evaluateReachability — open ports", () => {
  it("parses world-open ports from an attached security group", () => {
    const igw = res("internet-gateway", "igw");
    const ec2 = res("ec2-instance", "web");
    const sg = res("security-group", "web-sg", {
      config: { ingress: "tcp 22 0.0.0.0/0\ntcp 443 0.0.0.0/0\ntcp 8080 10.0.0.0/8" },
    });
    const g = graphOf(
      [igw, ec2, sg],
      [rel(igw.id, ec2.id, "connects_to"), rel(sg.id, ec2.id, "attached_to")],
    );
    const r = evaluateReachability(g);
    const ex = r.exposed.find((e) => e.resourceId === ec2.id)!;
    const ports = ex.openPorts.map((p: OpenPort) => p.port);
    expect(ports).toContain(22);
    expect(ports).toContain(443);
    // 8080 is sourced from a private CIDR, not world-open.
    expect(ports).not.toContain(8080);
    // sensitive port 22 generates a note since the resource is internet-reachable.
    expect(r.notes.some((n) => n.includes("sensitive port 22"))).toBe(true);
  });

  it("does NOT generate a sensitive-port note when the resource is not internet-reachable", () => {
    const ec2 = res("ec2-instance", "internal");
    const sg = res("security-group", "sg", { config: { ingress: "tcp 22 0.0.0.0/0" } });
    const g = graphOf([ec2, sg], [rel(sg.id, ec2.id, "attached_to")]);
    const r = evaluateReachability(g);
    expect(r.exposed).toHaveLength(0);
    expect(r.notes.some((n) => n.includes("sensitive port"))).toBe(false);
  });

  it("ignores malformed and non-world ingress lines", () => {
    const igw = res("internet-gateway", "igw");
    const ec2 = res("ec2-instance", "web");
    const sg = res("security-group", "sg", {
      config: { ingress: "garbage\ntcp\ntcp 22-25 0.0.0.0/0\ntcp 80 0.0.0.0/0" },
    });
    const g = graphOf(
      [igw, ec2, sg],
      [rel(igw.id, ec2.id, "connects_to"), rel(sg.id, ec2.id, "attached_to")],
    );
    const r = evaluateReachability(g);
    const ex = r.exposed.find((e) => e.resourceId === ec2.id)!;
    // only the well-formed single-port world line (80) survives.
    expect(ex.openPorts.map((p) => p.port)).toEqual([80]);
  });
});

describe("evaluateReachability — determinism & empty", () => {
  it("returns an empty, stable result for an empty graph", () => {
    const r = evaluateReachability(emptyGraph("e"));
    expect(r.exposed).toEqual([]);
    expect(r.internetReachableIds.size).toBe(0);
    expect(r.publicSubnetIds.size).toBe(0);
    expect(r.notes).toEqual([]);
  });

  it("is idempotent and order-stable", () => {
    const igw = res("internet-gateway", "igw");
    const a = res("lambda", "alpha");
    const b = res("lambda", "beta");
    const g = graphOf(
      [igw, b, a],
      [rel(igw.id, a.id, "connects_to"), rel(igw.id, b.id, "connects_to")],
    );
    const r1 = evaluateReachability(g);
    const r2 = evaluateReachability(g);
    expect(r1.exposed.map((e) => e.name)).toEqual(r2.exposed.map((e) => e.name));
    // sorted by name: alpha before beta (igw also exposed; "igw" sorts after "beta")
    const names = r1.exposed.map((e) => e.name);
    expect(names).toEqual([...names].sort());
  });
});

describe("litReachable", () => {
  it("produces an OverlayLit-shaped set with externalNodes", () => {
    const vpc = res("vpc", "vpc");
    const igw = res("internet-gateway", "igw");
    const subnet = res("subnet-public", "pub", { parentId: vpc.id });
    const rt = res("route-table", "rt");
    const ec2 = res("ec2-instance", "web", { parentId: subnet.id });
    const g = graphOf(
      [vpc, igw, subnet, rt, ec2],
      [
        rel(rt.id, subnet.id, "attached_to"),
        rel(rt.id, igw.id, "routes_to", { destinationCidr: "0.0.0.0/0" }),
      ],
    );
    const lit = litReachable(g);
    expect(lit.externalNodes.has(ec2.id)).toBe(true);
    expect(lit.nodes.has(subnet.id)).toBe(true);
    expect(lit.nodes.has(igw.id)).toBe(true);
    // edges only connect two lit nodes
    for (const id of lit.edges) {
      const e = g.relationships.find((x) => x.id === id)!;
      expect(lit.nodes.has(e.from) && lit.nodes.has(e.to)).toBe(true);
    }
  });

  it("returns empty sets for a graph with no exposure", () => {
    const ec2 = res("ec2-instance", "internal");
    const lit = litReachable(graphOf([ec2]));
    expect(lit.externalNodes.size).toBe(0);
    expect(lit.edges.size).toBe(0);
  });
});
