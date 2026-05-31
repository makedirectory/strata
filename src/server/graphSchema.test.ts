import { describe, it, expect } from "vitest";
import {
  isInfrastructureGraph,
  hasGraphCollections,
  checkCollectionLimits,
  checkOptionalFields,
  pickWritableFields,
  MAX_COLLECTION_LENGTH,
} from "./graphSchema";

/** Minimal object satisfying every required collection field. */
function baseCollections() {
  return {
    name: "My Graph",
    accounts: [],
    resources: [],
    relationships: [],
  };
}

/** A fully-shaped InfrastructureGraph-like object. */
function baseGraph() {
  return {
    ...baseCollections(),
    id: "some-id",
    schemaVersion: 1,
  };
}

describe("hasGraphCollections", () => {
  it("accepts an object with name + all three collection arrays", () => {
    expect(hasGraphCollections(baseCollections())).toBe(true);
  });

  it("accepts extra/unknown fields alongside the required ones", () => {
    expect(
      hasGraphCollections({
        ...baseCollections(),
        id: "abc",
        schemaVersion: 7,
        description: "hi",
        viewport: { x: 1, y: 2, scale: 1 },
      }),
    ).toBe(true);
  });

  it("accepts a body that omits id, schemaVersion, and timestamps", () => {
    // These are server-owned; a write body without them must still pass.
    const c = baseCollections();
    expect("id" in c).toBe(false);
    expect("schemaVersion" in c).toBe(false);
    expect("createdAt" in c).toBe(false);
    expect("updatedAt" in c).toBe(false);
    expect(hasGraphCollections(c)).toBe(true);
  });

  it("rejects when name is missing", () => {
    const { name: _omit, ...rest } = baseCollections();
    expect(hasGraphCollections(rest)).toBe(false);
  });

  it("rejects when name is not a string", () => {
    expect(hasGraphCollections({ ...baseCollections(), name: 123 })).toBe(false);
  });

  it("rejects when accounts is missing", () => {
    const { accounts: _omit, ...rest } = baseCollections();
    expect(hasGraphCollections(rest)).toBe(false);
  });

  it("rejects when resources is missing", () => {
    const { resources: _omit, ...rest } = baseCollections();
    expect(hasGraphCollections(rest)).toBe(false);
  });

  it("rejects when relationships is missing", () => {
    const { relationships: _omit, ...rest } = baseCollections();
    expect(hasGraphCollections(rest)).toBe(false);
  });

  it("rejects when a collection is not an array", () => {
    expect(hasGraphCollections({ ...baseCollections(), resources: {} })).toBe(false);
    expect(hasGraphCollections({ ...baseCollections(), accounts: "nope" })).toBe(false);
    expect(hasGraphCollections({ ...baseCollections(), relationships: null })).toBe(false);
  });

  it("rejects non-object inputs", () => {
    expect(hasGraphCollections(null)).toBe(false);
    expect(hasGraphCollections(undefined)).toBe(false);
    expect(hasGraphCollections(42)).toBe(false);
    expect(hasGraphCollections("string")).toBe(false);
    expect(hasGraphCollections(true)).toBe(false);
  });

  it("rejects arrays (arrays are not plain records)", () => {
    expect(hasGraphCollections([])).toBe(false);
    expect(hasGraphCollections([baseCollections()])).toBe(false);
  });
});

describe("isInfrastructureGraph", () => {
  it("accepts a fully-shaped graph", () => {
    expect(isInfrastructureGraph(baseGraph())).toBe(true);
  });

  it("accepts non-empty collections", () => {
    expect(
      isInfrastructureGraph({
        ...baseGraph(),
        accounts: [{ id: "a" }],
        resources: [{ id: "r" }],
        relationships: [{ id: "e" }],
      }),
    ).toBe(true);
  });

  it("rejects when id is missing or not a string", () => {
    const { id: _omit, ...rest } = baseGraph();
    expect(isInfrastructureGraph(rest)).toBe(false);
    expect(isInfrastructureGraph({ ...baseGraph(), id: 5 })).toBe(false);
  });

  it("rejects when name is missing or not a string", () => {
    const { name: _omit, ...rest } = baseGraph();
    expect(isInfrastructureGraph(rest)).toBe(false);
    expect(isInfrastructureGraph({ ...baseGraph(), name: 5 })).toBe(false);
  });

  it("rejects when schemaVersion is missing or not a number", () => {
    const { schemaVersion: _omit, ...rest } = baseGraph();
    expect(isInfrastructureGraph(rest)).toBe(false);
    expect(isInfrastructureGraph({ ...baseGraph(), schemaVersion: "1" })).toBe(false);
  });

  it("rejects when any collection is missing or not an array", () => {
    expect(isInfrastructureGraph({ ...baseGraph(), accounts: {} })).toBe(false);
    expect(isInfrastructureGraph({ ...baseGraph(), resources: "x" })).toBe(false);
    expect(isInfrastructureGraph({ ...baseGraph(), relationships: null })).toBe(false);

    const { resources: _omit, ...rest } = baseGraph();
    expect(isInfrastructureGraph(rest)).toBe(false);
  });

  it("rejects non-objects, arrays, and null", () => {
    expect(isInfrastructureGraph(null)).toBe(false);
    expect(isInfrastructureGraph(undefined)).toBe(false);
    expect(isInfrastructureGraph(0)).toBe(false);
    expect(isInfrastructureGraph("graph")).toBe(false);
    expect(isInfrastructureGraph([])).toBe(false);
    expect(isInfrastructureGraph([baseGraph()])).toBe(false);
  });

  it("rejects collections whose elements are primitives, not objects", () => {
    // A stored/uploaded file with `resources: [42]` must not load as a graph.
    expect(isInfrastructureGraph({ ...baseGraph(), resources: [42] })).toBe(false);
    expect(isInfrastructureGraph({ ...baseGraph(), relationships: ["x"] })).toBe(false);
    expect(isInfrastructureGraph({ ...baseGraph(), accounts: [true] })).toBe(false);
    expect(isInfrastructureGraph({ ...baseGraph(), resources: [null] })).toBe(false);
    expect(isInfrastructureGraph({ ...baseGraph(), resources: [["nested"]] })).toBe(false);
  });
});

describe("checkOptionalFields", () => {
  it("returns null when description and viewport are absent", () => {
    expect(checkOptionalFields({ name: "g" })).toBeNull();
  });

  it("returns null for valid description and viewport", () => {
    expect(
      checkOptionalFields({ description: "hi", viewport: { x: 1, y: 2, scale: 1 } }),
    ).toBeNull();
  });

  it("treats explicit undefined optionals as absent", () => {
    expect(checkOptionalFields({ description: undefined, viewport: undefined })).toBeNull();
  });

  it("rejects a non-string description", () => {
    expect(checkOptionalFields({ description: 123 })).toMatch(/description must be a string/i);
  });

  it("rejects a non-object viewport", () => {
    expect(checkOptionalFields({ viewport: "x" })).toMatch(/viewport must be an object/i);
  });

  it("rejects a viewport with non-numeric fields", () => {
    expect(checkOptionalFields({ viewport: { x: 1, y: 2, scale: "1" } })).toMatch(
      /viewport must be an object/i,
    );
  });
});

describe("checkCollectionLimits", () => {
  function arr(n: number): unknown[] {
    return Array.from({ length: n }, (_, i) => ({ id: String(i) }));
  }

  it("returns null when all collections are within the cap", () => {
    expect(
      checkCollectionLimits({ accounts: [], resources: arr(5), relationships: arr(5) }),
    ).toBeNull();
  });

  it("returns null at exactly the cap (boundary)", () => {
    expect(
      checkCollectionLimits({
        accounts: [],
        resources: arr(MAX_COLLECTION_LENGTH),
        relationships: [],
      }),
    ).toBeNull();
  });

  it("returns an error when resources exceeds the cap", () => {
    const msg = checkCollectionLimits({
      accounts: [],
      resources: arr(MAX_COLLECTION_LENGTH + 1),
      relationships: [],
    });
    expect(msg).toMatch(/resources exceeds the maximum/i);
  });

  it("returns an error when relationships exceeds the cap", () => {
    const msg = checkCollectionLimits({
      accounts: [],
      resources: [],
      relationships: arr(MAX_COLLECTION_LENGTH + 1),
    });
    expect(msg).toMatch(/relationships exceeds the maximum/i);
  });

  it("returns an error when accounts exceeds the cap", () => {
    const msg = checkCollectionLimits({
      accounts: arr(MAX_COLLECTION_LENGTH + 1),
      resources: [],
      relationships: [],
    });
    expect(msg).toMatch(/accounts exceeds the maximum/i);
  });
});

describe("pickWritableFields", () => {
  it("copies only client-writable fields, dropping server-owned and unknown keys", () => {
    const picked = pickWritableFields({
      name: "Graph",
      description: "d",
      accounts: [],
      resources: [{ id: "r" }],
      relationships: [],
      viewport: { x: 1, y: 2, scale: 1 },
      // dropped:
      id: "should-not-survive",
      schemaVersion: 99,
      createdAt: "2020-01-01",
      updatedAt: "2020-01-02",
      bogus: "nope",
    });
    expect(Object.keys(picked).sort()).toEqual(
      ["accounts", "description", "name", "relationships", "resources", "viewport"].sort(),
    );
    expect(picked).not.toHaveProperty("id");
    expect(picked).not.toHaveProperty("schemaVersion");
    expect(picked).not.toHaveProperty("createdAt");
    expect(picked).not.toHaveProperty("updatedAt");
    expect(picked).not.toHaveProperty("bogus");
  });

  it("only copies keys the caller actually provided (so emptyGraph defaults survive)", () => {
    const picked = pickWritableFields({ name: "Just a name" });
    expect(Object.keys(picked)).toEqual(["name"]);
  });

  it("passes through wrong-typed values unchanged (type checks happen at the route)", () => {
    // pickWritableFields is a pure projection; route/validateGraph reject bad types.
    const picked = pickWritableFields({ resources: "x" });
    expect(picked.resources).toBe("x" as unknown);
  });
});
