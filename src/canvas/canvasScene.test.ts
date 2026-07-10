import { describe, it, expect } from "vitest";
import { buildCanvasScene, paintScene, type SceneNode } from "./canvasScene";

const node = (over: Partial<SceneNode> & { id: string }): SceneNode => ({
  rect: { x: 0, y: 0, w: 100, h: 60 },
  depth: 0,
  isContainer: false,
  color: "#38bdf8",
  icon: "🟦",
  label: over.id,
  selected: false,
  ...over,
});

describe("buildCanvasScene", () => {
  it("splits containers from leaves and orders containers shallow→deep", () => {
    const scene = buildCanvasScene(
      [
        node({ id: "subnet", isContainer: true, depth: 2 }),
        node({ id: "vpc", isContainer: true, depth: 1 }),
        node({ id: "ec2", depth: 3 }),
      ],
      [],
    );
    expect(scene.containers.map((c) => c.id)).toEqual(["vpc", "subnet"]); // depth asc
    expect(scene.leaves.map((l) => l.id)).toEqual(["ec2"]);
  });

  it("culls nodes outside the viewport world rect", () => {
    const cull = { x: 0, y: 0, w: 200, h: 200 };
    const scene = buildCanvasScene(
      [
        node({ id: "in", rect: { x: 10, y: 10, w: 50, h: 50 } }),
        node({ id: "out", rect: { x: 1000, y: 1000, w: 50, h: 50 } }),
      ],
      [],
      cull,
    );
    expect(scene.leaves.map((l) => l.id)).toEqual(["in"]);
  });

  it("resolves edges only when both endpoints are visible", () => {
    const cull = { x: 0, y: 0, w: 200, h: 200 };
    const scene = buildCanvasScene(
      [
        node({ id: "a", rect: { x: 0, y: 0, w: 50, h: 50 } }),
        node({ id: "b", rect: { x: 60, y: 60, w: 50, h: 50 } }),
        node({ id: "far", rect: { x: 9000, y: 9000, w: 50, h: 50 } }),
      ],
      [
        { from: "a", to: "b" }, // both visible → kept
        { from: "a", to: "far" }, // endpoint culled → dropped
        { from: "a", to: "a" }, // self-loop → dropped
      ],
      cull,
    );
    expect(scene.edges).toHaveLength(1);
    expect(scene.edges[0].from).toEqual({ x: 0, y: 0, w: 50, h: 50 });
  });
});

/** A recording 2D-context stand-in that tallies method calls (no real canvas). */
function mockCtx() {
  const calls: Record<string, number> = {};
  const bump = (k: string) => (calls[k] = (calls[k] ?? 0) + 1);
  const ctx = {
    setTransform: () => bump("setTransform"),
    clearRect: () => bump("clearRect"),
    beginPath: () => bump("beginPath"),
    moveTo: () => bump("moveTo"),
    lineTo: () => bump("lineTo"),
    arcTo: () => bump("arcTo"),
    closePath: () => bump("closePath"),
    stroke: () => bump("stroke"),
    fill: () => bump("fill"),
    fillText: () => bump("fillText"),
    save: () => bump("save"),
    restore: () => bump("restore"),
    setLineDash: () => bump("setLineDash"),
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    font: "",
    textBaseline: "",
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

describe("paintScene", () => {
  it("clears, transforms, and paints cards/edges/labels without throwing", () => {
    const scene = buildCanvasScene(
      [
        node({ id: "vpc", isContainer: true, depth: 0, rect: { x: 0, y: 0, w: 300, h: 200 } }),
        node({ id: "ec2", depth: 1, rect: { x: 20, y: 40, w: 120, h: 60 }, selected: true }),
      ],
      [],
    );
    const { ctx, calls } = mockCtx();
    paintScene(ctx, scene, { x: 0, y: 0, scale: 1 }, { dpr: 2, cssWidth: 800, cssHeight: 600 });
    expect(calls.setTransform).toBeGreaterThan(0);
    expect(calls.clearRect).toBe(1);
    expect(calls.fill).toBeGreaterThan(0);
    expect(calls.fillText).toBe(2); // one label per node
    expect(calls.stroke).toBeGreaterThan(0); // card borders + selection ring
  });
});
