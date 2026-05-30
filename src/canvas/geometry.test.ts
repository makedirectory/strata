import { describe, it, expect } from "vitest";
import {
  clampScale,
  screenToWorld,
  zoomAbout,
  zoomByFactor,
  normalizeRect,
  unionRect,
  boundsOf,
  fitView,
  computeSnap,
  nodesInRect,
  viewportWorldRect,
  minimapTransform,
  worldToMinimap,
  minimapToWorld,
  panToCenter,
  lodTier,
  nodeRenderHeight,
  MIN_SCALE,
  MAX_SCALE,
  GRID_STEP,
  COMPACT_NEAR_HEIGHT,
  MID_HEIGHT,
  FAR_HEIGHT,
  type Rect,
  type NodeBox,
} from "./geometry";

describe("clampScale", () => {
  it("clamps to the interactive bounds", () => {
    expect(clampScale(100)).toBe(MAX_SCALE);
    expect(clampScale(0.001)).toBe(MIN_SCALE);
    expect(clampScale(1)).toBe(1);
  });
  it("honours custom bounds", () => {
    expect(clampScale(10, 0, 1.6)).toBe(1.6);
  });
});

describe("screenToWorld", () => {
  it("inverts pan + scale", () => {
    const pan = { x: 100, y: 50, scale: 2 };
    expect(screenToWorld({ x: 300, y: 150 }, pan)).toEqual({ x: 100, y: 50 });
  });
});

describe("zoomAbout", () => {
  it("keeps the world point under the cursor fixed", () => {
    const pan = { x: 100, y: 100, scale: 1 };
    const cursor = { x: 400, y: 300 };
    const worldBefore = screenToWorld(cursor, pan);
    const next = zoomAbout(pan, cursor, 2);
    const worldAfter = screenToWorld(cursor, next);
    expect(next.scale).toBe(2);
    expect(worldAfter.x).toBeCloseTo(worldBefore.x, 6);
    expect(worldAfter.y).toBeCloseTo(worldBefore.y, 6);
  });
  it("clamps the resulting scale", () => {
    const pan = { x: 0, y: 0, scale: 1 };
    expect(zoomAbout(pan, { x: 0, y: 0 }, 999).scale).toBe(MAX_SCALE);
    expect(zoomAbout(pan, { x: 0, y: 0 }, 0).scale).toBe(MIN_SCALE);
  });
  it("recentres on a 100% reset about a point", () => {
    const pan = { x: -500, y: -200, scale: 0.5 };
    const center = { x: 400, y: 300 };
    const worldCenter = screenToWorld(center, pan);
    const reset = zoomAbout(pan, center, 1);
    expect(reset.scale).toBe(1);
    expect(screenToWorld(center, reset).x).toBeCloseTo(worldCenter.x, 6);
  });
});

describe("zoomByFactor", () => {
  it("multiplies the current scale", () => {
    const pan = { x: 0, y: 0, scale: 1 };
    expect(zoomByFactor(pan, { x: 0, y: 0 }, 1.2).scale).toBeCloseTo(1.2, 6);
  });
});

describe("normalizeRect", () => {
  it("normalizes any drag direction", () => {
    expect(normalizeRect({ x: 30, y: 40 }, { x: 10, y: 10 })).toEqual({
      x: 10,
      y: 10,
      w: 20,
      h: 30,
    });
  });
});

describe("unionRect / boundsOf", () => {
  it("unions two rects", () => {
    expect(unionRect({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 })).toEqual({
      x: 0,
      y: 0,
      w: 15,
      h: 15,
    });
  });
  it("bounds a set, null when empty", () => {
    expect(boundsOf([])).toBeNull();
    expect(
      boundsOf([
        { x: 10, y: 10, w: 10, h: 10 },
        { x: 50, y: 30, w: 20, h: 20 },
      ]),
    ).toEqual({ x: 10, y: 10, w: 60, h: 40 });
  });
});

describe("fitView", () => {
  it("centres the bounds within the view", () => {
    const bounds: Rect = { x: 0, y: 0, w: 400, h: 400 };
    const vp = fitView(bounds, { width: 1000, height: 1000 }, { margin: 100 });
    // scale = (1000-200)/400 = 2, but capped at maxScale 1.6
    expect(vp.scale).toBe(1.6);
    // symmetric centring: same x/y for a square bounds in a square view
    expect(vp.x).toBeCloseTo(vp.y, 6);
  });
  it("can zoom far out for big graphs", () => {
    const vp = fitView({ x: 0, y: 0, w: 100000, h: 100000 }, { width: 800, height: 600 });
    expect(vp.scale).toBeLessThan(MIN_SCALE);
    expect(vp.scale).toBeGreaterThan(0);
  });
});

describe("computeSnap", () => {
  const box = (x: number, y: number): Rect => ({ x, y, w: 100, h: 50 });

  it("snaps to the grid when nothing aligns", () => {
    const r = computeSnap({ x: 103, y: 47, w: 100, h: 50 }, []);
    expect(r.x % GRID_STEP).toBe(0);
    expect(r.y % GRID_STEP).toBe(0);
    expect(r.x).toBe(96); // round(103/16)*16
    expect(r.y).toBe(48); // round(47/16)*16
    expect(r.guides).toHaveLength(0);
  });

  it("aligns left edges to another node and emits a vertical guide", () => {
    const other = box(200, 400);
    // dragged left edge at 197 is within threshold(8) of other left edge 200
    const r = computeSnap({ x: 197, y: 410, w: 100, h: 50 }, [other], { threshold: 8 });
    expect(r.x).toBe(200);
    const vGuide = r.guides.find((g) => g.axis === "x");
    expect(vGuide?.pos).toBe(200);
  });

  it("aligns horizontal centres and emits a horizontal guide", () => {
    const other = box(500, 100); // centerY = 125
    // dragged centerY target 125 → top = 100; start near it
    const r = computeSnap({ x: 480, y: 102, w: 100, h: 50 }, [other], { threshold: 8 });
    expect(r.y).toBe(100);
    expect(r.guides.some((g) => g.axis === "y")).toBe(true);
  });

  it("prefers the closest alignment over the grid", () => {
    const other = box(160, 300); // right edge 260
    // dragged right edge near 260 within threshold
    const r = computeSnap({ x: 158, y: 300, w: 100, h: 50 }, [other], { threshold: 6 });
    expect(r.x).toBe(160);
  });
});

describe("nodesInRect", () => {
  const boxes: NodeBox[] = [
    { id: "a", x: 10, y: 10, w: 20, h: 20 },
    { id: "b", x: 100, y: 100, w: 20, h: 20 },
    { id: "c", x: 200, y: 200, w: 50, h: 50 },
  ];
  it("returns fully enclosed boxes only", () => {
    expect(nodesInRect(boxes, { x: 0, y: 0, w: 130, h: 130 })).toEqual(["a", "b"]);
  });
  it("excludes partially overlapping boxes", () => {
    expect(nodesInRect(boxes, { x: 0, y: 0, w: 220, h: 220 })).toEqual(["a", "b"]);
  });
});

describe("minimap mapping", () => {
  it("round-trips world ↔ minimap", () => {
    const content: Rect = { x: 0, y: 0, w: 1000, h: 800 };
    const vp = viewportWorldRect({ x: -100, y: -50, scale: 1 }, { width: 800, height: 600 });
    const t = minimapTransform(content, vp, { w: 180, h: 120 });
    const p = { x: 350, y: 220 };
    const round = minimapToWorld(t, worldToMinimap(t, p));
    expect(round.x).toBeCloseTo(p.x, 6);
    expect(round.y).toBeCloseTo(p.y, 6);
  });
  it("includes the viewport rect in the union (indicator stays visible)", () => {
    const content: Rect = { x: 0, y: 0, w: 100, h: 100 };
    // viewport panned far away from content
    const vp: Rect = { x: 5000, y: 5000, w: 400, h: 300 };
    const t = minimapTransform(content, vp, { w: 180, h: 120 });
    // a point inside the viewport maps within the minimap canvas bounds
    const mp = worldToMinimap(t, { x: 5200, y: 5150 });
    expect(mp.x).toBeGreaterThanOrEqual(0);
    expect(mp.x).toBeLessThanOrEqual(180);
    expect(mp.y).toBeGreaterThanOrEqual(0);
    expect(mp.y).toBeLessThanOrEqual(120);
  });
});

describe("viewportWorldRect", () => {
  it("describes the visible world rectangle", () => {
    const r = viewportWorldRect({ x: -200, y: -100, scale: 2 }, { width: 800, height: 600 });
    expect(r).toEqual({ x: 100, y: 50, w: 400, h: 300 });
  });
});

describe("panToCenter", () => {
  it("centres a world point in the view", () => {
    const pan = panToCenter({ x: 500, y: 500 }, { width: 800, height: 600 }, 1);
    // world point should land at the view centre (400,300) in local coords
    expect(pan.x + 500 * pan.scale).toBe(400);
    expect(pan.y + 500 * pan.scale).toBe(300);
  });
});

describe("lodTier", () => {
  it("maps scale to far/mid/near tiers", () => {
    expect(lodTier(0.2)).toBe("far");
    expect(lodTier(0.39)).toBe("far");
    expect(lodTier(0.4)).toBe("mid");
    expect(lodTier(0.74)).toBe("mid");
    expect(lodTier(0.75)).toBe("near");
    expect(lodTier(2)).toBe("near");
  });
});

describe("nodeRenderHeight", () => {
  it("honours base height at near/comfortable, trims otherwise", () => {
    expect(nodeRenderHeight("near", "comfortable", 100)).toBe(100);
    expect(nodeRenderHeight("near", "compact", 100)).toBe(COMPACT_NEAR_HEIGHT);
    expect(nodeRenderHeight("mid", "comfortable", 100)).toBe(MID_HEIGHT);
    expect(nodeRenderHeight("mid", "compact", 100)).toBe(MID_HEIGHT);
    expect(nodeRenderHeight("far", "comfortable", 100)).toBe(FAR_HEIGHT);
    expect(nodeRenderHeight("far", "compact", 100)).toBe(FAR_HEIGHT);
  });
});
