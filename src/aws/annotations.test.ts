import { describe, it, expect } from "vitest";
import { emptyGraph, type InfrastructureGraph } from "./model";
import {
  ANNOTATION_KINDS,
  addAnnotation,
  clampAnnotation,
  isAnnotation,
  isAnnotationGraph,
  isAnnotationKind,
  isSafeAnnotationColor,
  listAnnotations,
  removeAnnotation,
  updateAnnotation,
  type Annotation,
  type AnnotationGraph,
} from "./annotations";

function ann(over: Partial<Annotation> & { id: string }): Annotation {
  return { kind: "note", text: "", x: 0, y: 0, ...over };
}

describe("isAnnotationKind", () => {
  it("accepts the three known kinds and nothing else", () => {
    for (const k of ANNOTATION_KINDS) expect(isAnnotationKind(k)).toBe(true);
    expect(isAnnotationKind("zoneX")).toBe(false);
    expect(isAnnotationKind(42)).toBe(false);
    expect(isAnnotationKind(undefined)).toBe(false);
  });
});

describe("isAnnotation", () => {
  it("accepts a minimal valid annotation", () => {
    expect(isAnnotation({ id: "a1", kind: "note", text: "hi", x: 10, y: 20 })).toBe(true);
  });

  it("accepts optional fields when well-typed", () => {
    expect(
      isAnnotation({
        id: "a1",
        kind: "zone",
        text: "",
        x: 0,
        y: 0,
        w: 100,
        h: 50,
        color: "#fff",
        targetId: "r1",
      }),
    ).toBe(true);
  });

  it("rejects malformed values", () => {
    expect(isAnnotation(null)).toBe(false);
    expect(isAnnotation("note")).toBe(false);
    expect(isAnnotation({ id: "", kind: "note", text: "x", x: 0, y: 0 })).toBe(false);
    expect(isAnnotation({ id: "a", kind: "bad", text: "x", x: 0, y: 0 })).toBe(false);
    expect(isAnnotation({ id: "a", kind: "note", text: 5, x: 0, y: 0 })).toBe(false);
    expect(isAnnotation({ id: "a", kind: "note", text: "x", x: NaN, y: 0 })).toBe(false);
    expect(isAnnotation({ id: "a", kind: "note", text: "x", x: 0, y: Infinity })).toBe(false);
    expect(isAnnotation({ id: "a", kind: "note", text: "x", x: 0, y: 0, w: "wide" })).toBe(false);
    expect(isAnnotation({ id: "a", kind: "note", text: "x", x: 0, y: 0, color: 1 })).toBe(false);
    expect(isAnnotation({ id: "a", kind: "note", text: "x", x: 0, y: 0, targetId: 2 })).toBe(false);
  });
});

describe("isSafeAnnotationColor", () => {
  it("accepts #hex (3/6/8), rgb()/rgba(), var(--…) and named-color tokens", () => {
    expect(isSafeAnnotationColor("#fff")).toBe(true);
    expect(isSafeAnnotationColor("#34d399")).toBe(true);
    expect(isSafeAnnotationColor("#11223344")).toBe(true);
    expect(isSafeAnnotationColor("rgb(1,2,3)")).toBe(true);
    expect(isSafeAnnotationColor("rgba(1, 2, 3, 0.5)")).toBe(true);
    expect(isSafeAnnotationColor("var(--accent)")).toBe(true);
    expect(isSafeAnnotationColor("tomato")).toBe(true);
  });

  it("rejects style-injection and other unsafe forms", () => {
    expect(isSafeAnnotationColor("red; background:url(x)")).toBe(false);
    expect(isSafeAnnotationColor("url(javascript:alert(1))")).toBe(false);
    expect(isSafeAnnotationColor("#12")).toBe(false);
    expect(isSafeAnnotationColor("#xyzxyz")).toBe(false);
    expect(isSafeAnnotationColor("expression(1)")).toBe(false);
    expect(isSafeAnnotationColor("")).toBe(false);
    expect(isSafeAnnotationColor(123)).toBe(false);
    expect(isSafeAnnotationColor(undefined)).toBe(false);
  });
});

describe("isAnnotationGraph", () => {
  it("treats a plain graph (no annotations field) as a valid annotation graph", () => {
    expect(isAnnotationGraph(emptyGraph())).toBe(true);
  });

  it("accepts a graph with a valid annotations array", () => {
    const g: AnnotationGraph = { ...emptyGraph(), annotations: [ann({ id: "a1" })] };
    expect(isAnnotationGraph(g)).toBe(true);
  });

  it("rejects a graph whose annotations field is not an array", () => {
    const g = { ...emptyGraph(), annotations: "nope" } as unknown as InfrastructureGraph;
    expect(isAnnotationGraph(g)).toBe(false);
  });

  it("rejects a graph with a malformed annotation entry", () => {
    const g = {
      ...emptyGraph(),
      annotations: [{ id: "a1", kind: "note", text: "ok", x: 0, y: 0 }, { id: "" }],
    } as unknown as InfrastructureGraph;
    expect(isAnnotationGraph(g)).toBe(false);
  });
});

describe("listAnnotations", () => {
  it("returns [] for a plain graph", () => {
    expect(listAnnotations(emptyGraph())).toEqual([]);
  });

  it("filters out malformed entries and returns clones", () => {
    const original = ann({ id: "a1", text: "hello" });
    const g = {
      ...emptyGraph(),
      annotations: [original, { id: "" }],
    } as unknown as InfrastructureGraph;
    const out = listAnnotations(g);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual(original);
    expect(out[0]).not.toBe(original); // clone, not the same reference
  });

  it("returns [] when annotations field is malformed", () => {
    const g = { ...emptyGraph(), annotations: 5 } as unknown as InfrastructureGraph;
    expect(listAnnotations(g)).toEqual([]);
  });
});

describe("clampAnnotation", () => {
  it("forces non-finite coordinates to 0", () => {
    const out = clampAnnotation(ann({ id: "a", x: NaN, y: Infinity }));
    expect(out.x).toBe(0);
    expect(out.y).toBe(0);
  });

  it("forces negative or non-finite sizes to 0 but preserves valid sizes", () => {
    expect(clampAnnotation(ann({ id: "a", w: -10, h: 50 }))).toMatchObject({ w: 0, h: 50 });
    expect(clampAnnotation(ann({ id: "a", w: NaN }))).toMatchObject({ w: 0 });
  });

  it("does not mutate the input", () => {
    const input = ann({ id: "a", x: NaN });
    clampAnnotation(input);
    expect(Number.isNaN(input.x)).toBe(true);
  });
});

describe("addAnnotation", () => {
  it("adds to a plain graph without mutating it", () => {
    const g = emptyGraph();
    const out = addAnnotation(g, ann({ id: "a1", text: "first" }));
    expect(listAnnotations(out).map((a) => a.id)).toEqual(["a1"]);
    expect(listAnnotations(g)).toEqual([]); // input untouched
    expect(out).not.toBe(g);
  });

  it("upserts on duplicate id rather than duplicating", () => {
    let g: InfrastructureGraph = emptyGraph();
    g = addAnnotation(g, ann({ id: "a1", text: "v1" }));
    g = addAnnotation(g, ann({ id: "a1", text: "v2" }));
    const out = listAnnotations(g);
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe("v2");
  });

  it("clamps geometry on insert", () => {
    const out = addAnnotation(emptyGraph(), ann({ id: "a1", x: NaN, w: -5 }));
    expect(listAnnotations(out)[0]).toMatchObject({ x: 0, w: 0 });
  });

  it("preserves existing annotations when adding a new one", () => {
    let g: InfrastructureGraph = addAnnotation(emptyGraph(), ann({ id: "a1" }));
    g = addAnnotation(g, ann({ id: "a2" }));
    expect(listAnnotations(g).map((a) => a.id)).toEqual(["a1", "a2"]);
  });
});

describe("updateAnnotation", () => {
  it("applies a partial patch", () => {
    let g: InfrastructureGraph = addAnnotation(emptyGraph(), ann({ id: "a1", text: "old", x: 1 }));
    g = updateAnnotation(g, "a1", { text: "new", color: "#0f0" });
    const out = listAnnotations(g)[0];
    expect(out).toMatchObject({ id: "a1", text: "new", x: 1, color: "#0f0" });
  });

  it("cannot change the id", () => {
    let g: InfrastructureGraph = addAnnotation(emptyGraph(), ann({ id: "a1" }));
    // @ts-expect-error id is excluded from the patch type
    g = updateAnnotation(g, "a1", { id: "hacked", text: "x" });
    expect(listAnnotations(g)[0].id).toBe("a1");
  });

  it("is a no-op (new graph) when id not found", () => {
    const g = addAnnotation(emptyGraph(), ann({ id: "a1" }));
    const out = updateAnnotation(g, "missing", { text: "x" });
    expect(out).not.toBe(g);
    expect(listAnnotations(out)).toEqual(listAnnotations(g));
  });

  it("does not mutate the input graph", () => {
    const g = addAnnotation(emptyGraph(), ann({ id: "a1", text: "old" }));
    updateAnnotation(g, "a1", { text: "new" });
    expect(listAnnotations(g)[0].text).toBe("old");
  });
});

describe("removeAnnotation", () => {
  it("removes by id", () => {
    let g: InfrastructureGraph = addAnnotation(emptyGraph(), ann({ id: "a1" }));
    g = addAnnotation(g, ann({ id: "a2" }));
    g = removeAnnotation(g, "a1");
    expect(listAnnotations(g).map((a) => a.id)).toEqual(["a2"]);
  });

  it("is a no-op (new graph) when id not found", () => {
    const g = addAnnotation(emptyGraph(), ann({ id: "a1" }));
    const out = removeAnnotation(g, "missing");
    expect(out).not.toBe(g);
    expect(listAnnotations(out).map((a) => a.id)).toEqual(["a1"]);
  });

  it("does not mutate the input graph", () => {
    const g = addAnnotation(emptyGraph(), ann({ id: "a1" }));
    removeAnnotation(g, "a1");
    expect(listAnnotations(g).map((a) => a.id)).toEqual(["a1"]);
  });
});

describe("round-trip / idempotency", () => {
  it("add then remove returns to empty layer", () => {
    let g: InfrastructureGraph = emptyGraph();
    g = addAnnotation(g, ann({ id: "a1" }));
    g = removeAnnotation(g, "a1");
    expect(listAnnotations(g)).toEqual([]);
  });

  it("listAnnotations(addAnnotation(...)) round-trips the annotation value", () => {
    const a = ann({
      id: "a1",
      kind: "zone",
      text: "vpc",
      x: 5,
      y: 6,
      w: 100,
      h: 80,
      color: "#abc",
      targetId: "r1",
    });
    const g = addAnnotation(emptyGraph(), a);
    expect(listAnnotations(g)).toEqual([a]);
  });

  it("preserves ordering across mixed operations deterministically", () => {
    let g: InfrastructureGraph = emptyGraph();
    g = addAnnotation(g, ann({ id: "a1" }));
    g = addAnnotation(g, ann({ id: "a2" }));
    g = addAnnotation(g, ann({ id: "a3" }));
    g = removeAnnotation(g, "a2");
    g = updateAnnotation(g, "a1", { text: "x" });
    expect(listAnnotations(g).map((a) => a.id)).toEqual(["a1", "a3"]);
  });
});
