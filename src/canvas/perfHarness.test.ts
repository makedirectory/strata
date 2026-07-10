import { describe, it, expect } from "vitest";
import { generateSyntheticGraph } from "./perfHarness";
import { getService } from "../aws/registry";

describe("generateSyntheticGraph", () => {
  it("produces exactly N resources with valid, nested services", () => {
    for (const n of [1, 100, 1000, 2000]) {
      const g = generateSyntheticGraph(n);
      expect(g.resources.length).toBe(n);
      // Every serviceId resolves in the registry (real colours/icons/pills).
      for (const r of g.resources) expect(getService(r.serviceId)).toBeDefined();
    }
  });

  it("builds real containment (nested nodes with resolvable parents) and edges", () => {
    const g = generateSyntheticGraph(500);
    const ids = new Set(g.resources.map((r) => r.id));
    const nested = g.resources.filter((r) => r.parentId);
    expect(nested.length).toBeGreaterThan(0);
    for (const r of nested) expect(ids.has(r.parentId!)).toBe(true); // no dangling parents
    // Some relationships, all with in-graph endpoints.
    expect(g.relationships.length).toBeGreaterThan(0);
    for (const e of g.relationships) {
      expect(ids.has(e.from)).toBe(true);
      expect(ids.has(e.to)).toBe(true);
    }
  });

  it("is deterministic (same N → identical graph)", () => {
    expect(generateSyntheticGraph(300)).toEqual(generateSyntheticGraph(300));
  });
});
