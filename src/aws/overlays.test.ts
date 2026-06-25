import { describe, it, expect } from "vitest";
import {
  iamTrustOverlay,
  securityPathOverlay,
  overlayLitFor,
  heatByDegree,
  heatColor,
  planChangeColor,
  planTintMap,
} from "./overlays";
import type { ResourceInstance, Relationship } from "./model";
import type { RelationshipKind } from "./types";

function res(
  id: string,
  serviceId = "ec2",
  config: Record<string, unknown> = {},
): ResourceInstance {
  return { id, serviceId, name: id, config, source: "manual" };
}
function rel(id: string, from: string, to: string, kind: RelationshipKind): Relationship {
  return { id, from, to, kind, source: "manual" };
}

const resources = ["role", "policy", "user", "vpc", "subnet", "lonely"].map((id) => res(id));
const relationships: Relationship[] = [
  rel("e1", "user", "role", "assumes"), // permission
  rel("e2", "role", "policy", "grants"), // permission
  rel("e3", "vpc", "subnet", "routes_to"), // network
  rel("e4", "subnet", "role", "connects_to"), // network
];

describe("iamTrustOverlay", () => {
  it("lights the whole permission subgraph with no focus", () => {
    const lit = iamTrustOverlay(resources, relationships);
    expect([...lit.edges].sort()).toEqual(["e1", "e2"]);
    expect(lit.nodes.has("user")).toBe(true);
    expect(lit.nodes.has("policy")).toBe(true);
    expect(lit.nodes.has("vpc")).toBe(false); // network node, not permission
  });

  it("traces the trust neighbourhood from a focus node", () => {
    const lit = iamTrustOverlay(resources, relationships, "user");
    // user → role → policy over permission edges
    expect(lit.nodes).toEqual(new Set(["user", "role", "policy"]));
    expect(lit.edges).toEqual(new Set(["e1", "e2"]));
    expect(lit.nodes.has("subnet")).toBe(false); // reached only via network edge
  });
});

describe("securityPathOverlay", () => {
  it("traces the network neighbourhood from a focus node", () => {
    const lit = securityPathOverlay(resources, relationships, "vpc");
    // vpc → subnet → role over network edges
    expect(lit.nodes).toEqual(new Set(["vpc", "subnet", "role"]));
    expect(lit.edges).toEqual(new Set(["e3", "e4"]));
  });

  it("lights the whole network subgraph with no focus", () => {
    const lit = securityPathOverlay(resources, relationships);
    expect([...lit.edges].sort()).toEqual(["e3", "e4"]);
  });

  it("traces load-balancer `targets` edges even though they colour as data flow", () => {
    const r = [res("alb", "elastic-load-balancer"), res("tg", "target-group"), res("svc")];
    const rels = [rel("t1", "alb", "tg", "targets"), rel("t2", "tg", "svc", "targets")];
    const lit = securityPathOverlay(r, rels);
    expect(lit.nodes).toEqual(new Set(["alb", "tg", "svc"]));
    expect([...lit.edges].sort()).toEqual(["t1", "t2"]);
  });

  it("flags internet-facing nodes and the edges that touch them as external", () => {
    const r = [
      res("igw", "internet-gateway"),
      res("rt", "route-table"),
      res("subnet", "subnet-private"),
    ];
    const rels = [
      rel("x1", "rt", "igw", "routes_to"), // touches the IGW → external
      rel("x2", "rt", "subnet", "attached_to"), // intranet only → internal
    ];
    const lit = securityPathOverlay(r, rels);
    expect(lit.externalNodes).toEqual(new Set(["igw"]));
    expect(lit.externalEdges).toEqual(new Set(["x1"]));
  });

  it("treats an internal-scheme load balancer as not external", () => {
    const r = [
      res("alb", "elastic-load-balancer", { scheme: "internal" }),
      res("tg", "target-group"),
    ];
    const lit = securityPathOverlay(r, [rel("e", "alb", "tg", "targets")]);
    expect(lit.externalNodes?.size).toBe(0);
    expect(lit.externalEdges?.size).toBe(0);
  });
});

describe("overlayLitFor", () => {
  it("returns the lit set for an overlay that has matching edges", () => {
    const lit = overlayLitFor("security", resources, relationships);
    expect(lit).not.toBeNull();
    expect([...lit!.edges].sort()).toEqual(["e3", "e4"]);
  });

  it("returns null (a no-op) when the overlay would light nothing", () => {
    // No network/permission edges → an empty lit set would dim the whole
    // canvas; the consumer must instead treat it as 'no overlay'.
    const noEdges = ["a", "b", "c"].map((id) => res(id));
    expect(overlayLitFor("security", noEdges, [])).toBeNull();
    expect(overlayLitFor("iam", noEdges, [])).toBeNull();
  });

  it("returns null for non-highlighting overlay kinds", () => {
    expect(overlayLitFor("none", resources, relationships)).toBeNull();
    expect(overlayLitFor("heat", resources, relationships)).toBeNull();
  });
});

describe("heatByDegree", () => {
  it("normalises degree to [0,1]; isolated nodes are 0", () => {
    const heat = heatByDegree(resources, relationships);
    // role touches e1,e2,e4 = degree 3 = max → 1
    expect(heat.get("role")).toBe(1);
    expect(heat.get("lonely")).toBe(0);
    expect(heat.get("user")).toBeCloseTo(1 / 3, 6);
  });
  it("is all-zero with no relationships", () => {
    const heat = heatByDegree(resources, []);
    expect([...heat.values()].every((v) => v === 0)).toBe(true);
  });
});

describe("heatColor", () => {
  it("ramps blue → red and clamps", () => {
    expect(heatColor(0)).toBe("rgb(59, 130, 246)");
    expect(heatColor(1)).toBe("rgb(239, 68, 68)");
    expect(heatColor(-5)).toBe(heatColor(0));
    expect(heatColor(5)).toBe(heatColor(1));
  });
});

describe("plan overlay tint", () => {
  it("colours changed kinds and leaves noop/read untinted", () => {
    expect(planChangeColor("create")).toBeTruthy();
    expect(planChangeColor("delete")).toBeTruthy();
    expect(planChangeColor("replace")).toBeTruthy();
    expect(planChangeColor("noop")).toBeNull();
    expect(planChangeColor("read")).toBeNull();
  });

  it("builds a tint map for only the changed nodes", () => {
    const map = planTintMap({ a: "create", b: "noop", c: "delete" });
    expect([...map.keys()].sort()).toEqual(["a", "c"]);
    expect(map.get("a")).toBe(planChangeColor("create"));
  });
});
