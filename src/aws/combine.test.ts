import { describe, it, expect } from "vitest";
import { combineGraphs } from "./combine";
import { emptyGraph, type InfrastructureGraph, type ResourceInstance } from "./model";
import { computeLayout } from "../canvas/layout";
import { getService } from "./registry";

function res(over: Partial<ResourceInstance> & { id: string }): ResourceInstance {
  return {
    serviceId: "ec2-instance",
    name: over.id,
    config: {},
    source: "imported",
    position: { x: 0, y: 0, w: 240, h: 100 },
    ...over,
  };
}

/** A tiny single-account graph: a VPC containing one EC2, with a relationship. */
function sampleGraph(name: string): InfrastructureGraph {
  const g = emptyGraph(name);
  g.resources = [
    res({ id: "vpc", serviceId: "vpc" }),
    res({ id: "web", serviceId: "ec2-instance", parentId: "vpc" }),
  ];
  g.relationships = [
    { id: "web-vpc", from: "web", to: "vpc", kind: "depends_on", source: "imported" },
  ];
  return g;
}

const isContainer = (r: ResourceInstance) => !!getService(r.serviceId)?.isContainer;

describe("combineGraphs", () => {
  it("namespaces ids so identical ids across sources never collide", () => {
    const merged = combineGraphs([
      { name: "prod", graph: sampleGraph("prod") },
      { name: "staging", graph: sampleGraph("staging") },
    ]);
    const ids = merged.resources.map((r) => r.id);
    // Four resources, all unique despite both sources using "vpc"/"web".
    expect(ids.length).toBe(4);
    expect(new Set(ids).size).toBe(4);
    // Each id is prefixed by its source slug.
    expect(ids.some((id) => id.startsWith("prod-0:"))).toBe(true);
    expect(ids.some((id) => id.startsWith("staging-1:"))).toBe(true);
  });

  it("rewrites relationship endpoints to the namespaced ids (still resolve)", () => {
    const merged = combineGraphs([
      { name: "prod", graph: sampleGraph("prod") },
      { name: "staging", graph: sampleGraph("staging") },
    ]);
    const ids = new Set(merged.resources.map((r) => r.id));
    expect(merged.relationships.length).toBe(2);
    for (const rel of merged.relationships) {
      expect(ids.has(rel.from), `${rel.from} resolves`).toBe(true);
      expect(ids.has(rel.to), `${rel.to} resolves`).toBe(true);
    }
  });

  it("keeps parentId inside its own source (no cross-source leakage)", () => {
    const merged = combineGraphs([
      { name: "prod", graph: sampleGraph("prod") },
      { name: "staging", graph: sampleGraph("staging") },
    ]);
    for (const r of merged.resources) {
      if (!r.parentId) continue;
      const [rPrefix] = r.id.split(":");
      const [pPrefix] = r.parentId.split(":");
      expect(pPrefix, `${r.id} parent stays in-source`).toBe(rPrefix);
    }
  });

  it("leaves roots position-less so the layout grid spreads them (no origin stacking)", () => {
    const merged = combineGraphs([
      { name: "a", graph: sampleGraph("a") },
      { name: "b", graph: sampleGraph("b") },
      { name: "c", graph: sampleGraph("c") },
    ]);
    // The three VPC roots carry no stored position.
    const roots = merged.resources.filter((r) => !r.parentId);
    expect(roots.length).toBe(3);
    for (const r of roots) expect(r.position).toBeUndefined();
    // computeLayout grids them: no two roots overlap.
    const { rects } = computeLayout(merged.resources, { isContainer });
    const rootRects = roots.map((r) => rects.get(r.id)!);
    const overlaps = (i: number, j: number) => {
      const a = rootRects[i];
      const b = rootRects[j];
      return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
    };
    expect(overlaps(0, 1)).toBe(false);
    expect(overlaps(0, 2)).toBe(false);
    expect(overlaps(1, 2)).toBe(false);
  });

  it("preserves root count across sources (un-wrapped)", () => {
    const merged = combineGraphs([
      { name: "a", graph: sampleGraph("a") },
      { name: "b", graph: sampleGraph("b") },
    ]);
    // Each source contributes exactly one root (its VPC).
    expect(merged.resources.filter((r) => !r.parentId).length).toBe(2);
  });

  it("wraps each source under one container node when wrapAs: 'container'", () => {
    const merged = combineGraphs(
      [
        { name: "prod", graph: sampleGraph("prod") },
        { name: "staging", graph: sampleGraph("staging") },
      ],
      { wrapAs: "container" },
    );
    // Two synthetic wrappers, each an isContainer service, are the only roots.
    const roots = merged.resources.filter((r) => !r.parentId);
    expect(roots.length).toBe(2);
    for (const r of roots) {
      expect(getService(r.serviceId)?.isContainer).toBe(true);
      expect(r.position).toBeUndefined();
    }
    // Each former source root now parents to its wrapper.
    const wrapperIds = new Set(roots.map((r) => r.id));
    const vpcs = merged.resources.filter((r) => r.serviceId === "vpc");
    for (const vpc of vpcs) expect(wrapperIds.has(vpc.parentId!)).toBe(true);
  });

  it("carries the raw IaC sidecar through unchanged", () => {
    const g = sampleGraph("prod");
    g.resources[0].raw = {
      format: "terraform",
      type: "aws_vpc",
      properties: { cidr: "10.0.0.0/16" },
    };
    const merged = combineGraphs([{ name: "prod", graph: g }]);
    const vpc = merged.resources.find((r) => r.serviceId === "vpc")!;
    expect(vpc.raw).toEqual({
      format: "terraform",
      type: "aws_vpc",
      properties: { cidr: "10.0.0.0/16" },
    });
  });
});
