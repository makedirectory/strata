import { describe, it, expect } from "vitest";
import { iamTrustOverlay, securityPathOverlay, heatByDegree, heatColor } from "./overlays";
import type { ResourceInstance, Relationship } from "./model";
import type { RelationshipKind } from "./types";

function res(id: string): ResourceInstance {
  return { id, serviceId: "ec2", name: id, config: {}, source: "manual" };
}
function rel(id: string, from: string, to: string, kind: RelationshipKind): Relationship {
  return { id, from, to, kind, source: "manual" };
}

const resources = ["role", "policy", "user", "vpc", "subnet", "lonely"].map(res);
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
