import { describe, it, expect } from "vitest";
import type { InfrastructureGraph, ResourceInstance, Relationship } from "./model";
import { SCHEMA_VERSION } from "./model";
import { collectTagKeys, collectTagValues, tagTintMap, filterByTag, tagCoverage } from "./tags";

function res(
  id: string,
  tags?: Record<string, string>,
  extra: Partial<ResourceInstance> = {},
): ResourceInstance {
  return {
    id,
    serviceId: "ec2-instance",
    name: id,
    config: {},
    source: "manual",
    ...(tags ? { tags } : {}),
    ...extra,
  };
}

function rel(id: string, from: string, to: string): Relationship {
  return { id, from, to, kind: "connects_to" };
}

function graph(
  resources: ResourceInstance[],
  relationships: Relationship[] = [],
): InfrastructureGraph {
  return {
    id: "g1",
    name: "test",
    accounts: [],
    resources,
    relationships,
    viewport: { x: 0, y: 0, scale: 1 },
    schemaVersion: SCHEMA_VERSION,
  };
}

describe("collectTagKeys", () => {
  it("returns sorted unique keys across resources", () => {
    const g = graph([
      res("a", { env: "prod", team: "core" }),
      res("b", { team: "core", owner: "x" }),
    ]);
    expect(collectTagKeys(g)).toEqual(["env", "owner", "team"]);
  });

  it("is empty when no resource has tags", () => {
    expect(collectTagKeys(graph([res("a"), res("b")]))).toEqual([]);
  });

  it("skips empty-string and non-string tag values", () => {
    const g = graph([
      res("a", { env: "", team: "core" }),
      // non-string value smuggled past the Record<string,string> type
      res("b", { env: 5 as unknown as string }),
    ]);
    expect(collectTagKeys(g)).toEqual(["team"]);
  });
});

describe("collectTagValues", () => {
  it("returns sorted unique values for a key", () => {
    const g = graph([
      res("a", { env: "prod" }),
      res("b", { env: "dev" }),
      res("c", { env: "prod" }),
    ]);
    expect(collectTagValues(g, "env")).toEqual(["dev", "prod"]);
  });

  it("is empty for an absent key", () => {
    expect(collectTagValues(graph([res("a", { env: "prod" })]), "team")).toEqual([]);
  });
});

describe("tagTintMap", () => {
  it("includes only resources carrying the key", () => {
    const g = graph([res("a", { env: "prod" }), res("b", {}), res("c", { env: "dev" })]);
    const map = tagTintMap(g, "env");
    expect([...map.keys()].sort()).toEqual(["a", "c"]);
  });

  it("assigns the same colour to equal values and is deterministic", () => {
    const g = graph([
      res("a", { env: "prod" }),
      res("b", { env: "prod" }),
      // "staging" hashes to a different palette slot than "prod"
      res("c", { env: "staging" }),
    ]);
    const m1 = tagTintMap(g, "env");
    const m2 = tagTintMap(g, "env");
    // same value -> same colour
    expect(m1.get("a")).toBe(m1.get("b"));
    // these two distinct values land on different palette slots
    expect(m1.get("a")).not.toBe(m1.get("c"));
    // re-run stable
    expect([...m2.entries()]).toEqual([...m1.entries()]);
  });

  it("emits valid hex colours", () => {
    const map = tagTintMap(graph([res("a", { env: "prod" })]), "env");
    expect(map.get("a")).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe("filterByTag", () => {
  it("keeps only matching resources and prunes dangling relationships", () => {
    const g = graph(
      [res("a", { env: "prod" }), res("b", { env: "dev" }), res("c", { env: "prod" })],
      [rel("e1", "a", "c"), rel("e2", "a", "b")],
    );
    const out = filterByTag(g, "env", "prod");
    expect(out.resources.map((r) => r.id).sort()).toEqual(["a", "c"]);
    // e1 survives (both endpoints kept); e2 dropped (b filtered out)
    expect(out.relationships.map((r) => r.id)).toEqual(["e1"]);
  });

  it("does not mutate the input graph", () => {
    const g = graph([res("a", { env: "prod" }), res("b", { env: "dev" })], [rel("e1", "a", "b")]);
    const beforeResLen = g.resources.length;
    const beforeRelLen = g.relationships.length;
    const out = filterByTag(g, "env", "prod");
    expect(g.resources.length).toBe(beforeResLen);
    expect(g.relationships.length).toBe(beforeRelLen);
    expect(out).not.toBe(g);
    expect(out.resources).not.toBe(g.resources);
  });

  it("does not match empty-string tag values and stays consistent with collectTagValues", () => {
    const g = graph([
      res("a", { env: "prod" }),
      res("b", { env: "" }), // empty value -> not a listed value, must not match
      res("c", { env: "prod" }),
    ]);
    // "" is never offered as a value by the UI...
    expect(collectTagValues(g, "env")).toEqual(["prod"]);
    // ...so filtering on it returns nothing (not the empty-string resource).
    expect(filterByTag(g, "env", "").resources.map((r) => r.id)).toEqual([]);
    // ...and filtering on a real value matches exactly the resources that carry it.
    expect(
      filterByTag(g, "env", "prod")
        .resources.map((r) => r.id)
        .sort(),
    ).toEqual(["a", "c"]);
  });

  it("carries through top-level fields and returns empty when nothing matches", () => {
    const g = graph([res("a", { env: "prod" })]);
    const out = filterByTag(g, "env", "nope");
    expect(out.resources).toEqual([]);
    expect(out.relationships).toEqual([]);
    expect(out.name).toBe(g.name);
    expect(out.viewport).toEqual(g.viewport);
    expect(out.schemaVersion).toBe(g.schemaVersion);
  });
});

describe("tagCoverage", () => {
  it("counts tagged vs untagged and the fraction", () => {
    const g = graph([res("a", { env: "prod" }), res("b"), res("c", { env: "" })]);
    // c has only an empty-string value -> counts as untagged
    expect(tagCoverage(g)).toEqual({ tagged: 1, untagged: 2, coverage: 1 / 3 });
  });

  it("is zero for an empty graph", () => {
    expect(tagCoverage(graph([]))).toEqual({ tagged: 0, untagged: 0, coverage: 0 });
  });
});
