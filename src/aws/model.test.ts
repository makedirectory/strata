import { describe, it, expect } from "vitest";
import {
  emptyGraph,
  summarize,
  resourcesByAccount,
  childrenOf,
  relationshipsOf,
  validateGraph,
  SCHEMA_VERSION,
  type InfrastructureGraph,
  type ResourceInstance,
  type Relationship,
} from "./model";

// ---- fixture helpers -------------------------------------------------------

function resource(over: Partial<ResourceInstance> & { id: string }): ResourceInstance {
  return {
    serviceId: "vpc",
    name: over.id,
    config: {},
    source: "manual",
    ...over,
  };
}

function relationship(
  over: Partial<Relationship> & { id: string; from: string; to: string },
): Relationship {
  return {
    kind: "contains",
    ...over,
  };
}

function graph(over: Partial<InfrastructureGraph> = {}): InfrastructureGraph {
  return {
    ...emptyGraph(),
    ...over,
  };
}

describe("emptyGraph", () => {
  it("returns a structurally valid empty graph with defaults", () => {
    const g = emptyGraph();
    expect(g.id).toBe("");
    expect(g.name).toBe("Untitled Architecture");
    expect(g.accounts).toEqual([]);
    expect(g.resources).toEqual([]);
    expect(g.relationships).toEqual([]);
    expect(g.viewport).toEqual({ x: 200, y: 120, scale: 1 });
    expect(g.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it("accepts a custom name", () => {
    expect(emptyGraph("My Env").name).toBe("My Env");
  });

  it("returns a fresh object each call (no shared mutable state)", () => {
    const a = emptyGraph();
    const b = emptyGraph();
    expect(a).not.toBe(b);
    expect(a.resources).not.toBe(b.resources);
    a.resources.push(resource({ id: "x" }));
    expect(b.resources).toHaveLength(0);
  });

  it("produces a graph that passes validateGraph", () => {
    expect(validateGraph(emptyGraph())).toEqual([]);
  });
});

describe("summarize", () => {
  it("projects the lightweight summary fields", () => {
    const g = graph({
      id: "g1",
      name: "Prod",
      description: "the prod env",
      updatedAt: "2026-01-01T00:00:00Z",
      resources: [resource({ id: "a" }), resource({ id: "b" }), resource({ id: "c" })],
    });
    expect(summarize(g)).toEqual({
      id: "g1",
      name: "Prod",
      description: "the prod env",
      resourceCount: 3,
      updatedAt: "2026-01-01T00:00:00Z",
    });
  });

  it("reports a zero count and omits optional fields when absent", () => {
    const s = summarize(emptyGraph());
    expect(s.resourceCount).toBe(0);
    expect(s.description).toBeUndefined();
    expect(s.updatedAt).toBeUndefined();
  });
});

describe("resourcesByAccount", () => {
  const g = graph({
    resources: [
      resource({ id: "a", accountId: "acct-1" }),
      resource({ id: "b", accountId: "acct-2" }),
      resource({ id: "c", accountId: "acct-1" }),
      resource({ id: "d" }), // no account
    ],
  });

  it("returns only resources in the given account", () => {
    expect(resourcesByAccount(g, "acct-1").map((r) => r.id)).toEqual(["a", "c"]);
    expect(resourcesByAccount(g, "acct-2").map((r) => r.id)).toEqual(["b"]);
  });

  it("returns an empty list for an unknown account", () => {
    expect(resourcesByAccount(g, "nope")).toEqual([]);
  });

  it("does not match resources lacking an accountId", () => {
    expect(resourcesByAccount(g, "acct-1").some((r) => r.id === "d")).toBe(false);
  });

  it("returns a fresh array, not the underlying resources array", () => {
    expect(resourcesByAccount(g, "acct-1")).not.toBe(g.resources);
  });
});

describe("childrenOf", () => {
  const g = graph({
    resources: [
      resource({ id: "vpc-1" }),
      resource({ id: "sn-1", parentId: "vpc-1" }),
      resource({ id: "sn-2", parentId: "vpc-1" }),
      resource({ id: "ec2-1", parentId: "sn-1" }),
      resource({ id: "orphan" }),
    ],
  });

  it("returns direct children only (not grandchildren)", () => {
    expect(childrenOf(g, "vpc-1").map((r) => r.id)).toEqual(["sn-1", "sn-2"]);
  });

  it("returns children of a nested parent", () => {
    expect(childrenOf(g, "sn-1").map((r) => r.id)).toEqual(["ec2-1"]);
  });

  it("returns empty for a leaf or unknown id", () => {
    expect(childrenOf(g, "ec2-1")).toEqual([]);
    expect(childrenOf(g, "missing")).toEqual([]);
  });
});

describe("relationshipsOf", () => {
  const g = graph({
    resources: [resource({ id: "a" }), resource({ id: "b" }), resource({ id: "c" })],
    relationships: [
      relationship({ id: "e1", from: "a", to: "b" }),
      relationship({ id: "e2", from: "b", to: "c" }),
      relationship({ id: "e3", from: "c", to: "a" }),
    ],
  });

  it("matches edges where the resource is the source", () => {
    expect(
      relationshipsOf(g, "a")
        .map((e) => e.id)
        .sort(),
    ).toEqual(["e1", "e3"]);
  });

  it("matches edges where the resource is the target", () => {
    // b is the target of e1 and source of e2
    expect(
      relationshipsOf(g, "b")
        .map((e) => e.id)
        .sort(),
    ).toEqual(["e1", "e2"]);
  });

  it("returns empty for a resource with no edges", () => {
    expect(relationshipsOf(graph({ resources: [resource({ id: "z" })] }), "z")).toEqual([]);
  });
});

describe("validateGraph", () => {
  it("returns no errors for a clean graph", () => {
    const g = graph({
      resources: [resource({ id: "vpc-1" }), resource({ id: "sn-1", parentId: "vpc-1" })],
      relationships: [relationship({ id: "e1", from: "vpc-1", to: "sn-1" })],
    });
    expect(validateGraph(g)).toEqual([]);
  });

  it("flags duplicate resource ids", () => {
    const g = graph({
      resources: [resource({ id: "dup" }), resource({ id: "dup" })],
    });
    const errors = validateGraph(g);
    expect(errors).toContain("Duplicate resource id dup");
    expect(errors).toHaveLength(1);
  });

  it("flags a dangling parentId", () => {
    const g = graph({
      resources: [resource({ id: "sn-1", parentId: "ghost-vpc" })],
    });
    expect(validateGraph(g)).toEqual(["Resource sn-1 references missing parent ghost-vpc"]);
  });

  it("does not flag a top-level resource with no parent", () => {
    const g = graph({ resources: [resource({ id: "top" })] });
    expect(validateGraph(g)).toEqual([]);
  });

  it("flags a relationship with a dangling 'from'", () => {
    const g = graph({
      resources: [resource({ id: "b" })],
      relationships: [relationship({ id: "e1", from: "ghost", to: "b" })],
    });
    expect(validateGraph(g)).toEqual(["Relationship e1 references missing from ghost"]);
  });

  it("flags a relationship with a dangling 'to'", () => {
    const g = graph({
      resources: [resource({ id: "a" })],
      relationships: [relationship({ id: "e1", from: "a", to: "ghost" })],
    });
    expect(validateGraph(g)).toEqual(["Relationship e1 references missing to ghost"]);
  });

  it("flags both endpoints when a relationship dangles on both sides", () => {
    const g = graph({
      relationships: [relationship({ id: "e1", from: "x", to: "y" })],
    });
    const errors = validateGraph(g);
    expect(errors).toContain("Relationship e1 references missing from x");
    expect(errors).toContain("Relationship e1 references missing to y");
    expect(errors).toHaveLength(2);
  });

  it("accumulates multiple distinct errors", () => {
    const g = graph({
      resources: [
        resource({ id: "dup" }),
        resource({ id: "dup" }),
        resource({ id: "sn", parentId: "nope" }),
      ],
      relationships: [relationship({ id: "e1", from: "ghost", to: "dup" })],
    });
    const errors = validateGraph(g);
    expect(errors).toContain("Duplicate resource id dup");
    expect(errors).toContain("Resource sn references missing parent nope");
    expect(errors).toContain("Relationship e1 references missing from ghost");
  });

  it("flags a resource referencing an unknown service", () => {
    const g = graph({ resources: [resource({ id: "x", serviceId: "not-a-real-service" })] });
    expect(validateGraph(g)).toEqual(["Resource x references unknown service not-a-real-service"]);
  });

  it("flags a self-referential relationship (from === to)", () => {
    const g = graph({
      resources: [resource({ id: "a" })],
      relationships: [relationship({ id: "e1", from: "a", to: "a" })],
    });
    expect(validateGraph(g)).toEqual(["Relationship e1 connects a to itself"]);
  });

  it("flags a duplicate relationship id", () => {
    const g = graph({
      resources: [resource({ id: "a" }), resource({ id: "b" }), resource({ id: "c" })],
      relationships: [
        relationship({ id: "e1", from: "a", to: "b" }),
        relationship({ id: "e1", from: "b", to: "c" }),
      ],
    });
    expect(validateGraph(g)).toEqual(["Duplicate relationship id e1"]);
  });

  it("rejects a non-object resource element (untrusted-body garbage)", () => {
    const g = graph({ resources: [42 as unknown as ResourceInstance] });
    expect(validateGraph(g)).toEqual(["Resource entry #0 is not a valid resource object"]);
  });

  it("rejects a non-object relationship element (untrusted-body garbage)", () => {
    const g = graph({
      resources: [resource({ id: "a" })],
      relationships: ["nope" as unknown as Relationship],
    });
    expect(validateGraph(g)).toEqual(["Relationship entry #0 is not a valid relationship object"]);
  });
});
