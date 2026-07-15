import { describe, it, expect } from "vitest";
import {
  buildCameraBasis,
  project,
  nodeGeom,
  boxCorners,
  BOX_FACES,
  bezier,
  pointInPoly,
  labelFontPx,
  hexToRgb,
  shade,
  norm,
  type OrbitCamera,
} from "./orbit3d";

const cam: OrbitCamera = {
  target: { x: 0, y: 0, z: 0 },
  az: 0,
  el: 0,
  dist: 10,
  fov: (60 * Math.PI) / 180,
};

describe("project", () => {
  it("projects the target to the screen centre and rejects points behind the camera", () => {
    const basis = buildCameraBasis(cam, 800, 600);
    const center = project(basis, { x: 0, y: 0, z: 0 });
    expect(center).not.toBeNull();
    expect(center!.sx).toBeCloseTo(400, 0);
    expect(center!.sy).toBeCloseTo(300, 0);
    // A point beyond the target (behind, from the eye's view) is culled.
    const behind = project(basis, { x: 0, y: 0, z: 100 });
    expect(behind).toBeNull();
  });
});

describe("buildCameraBasis top-down guard", () => {
  it("yields a finite, orthonormal basis looking straight down (no singularity)", () => {
    const top: OrbitCamera = { ...cam, el: Math.PI / 2 - 0.001, az: 0 };
    const b = buildCameraBasis(top, 800, 600);
    for (const v of [b.right, b.up, b.fwd]) {
      expect(Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z)).toBe(true);
      expect(Math.hypot(v.x, v.y, v.z)).toBeCloseTo(1); // unit length
    }
    // right ⟂ up (orthonormal)
    expect(b.right.x * b.up.x + b.right.y * b.up.y + b.right.z * b.up.z).toBeCloseTo(0);
    // A ground point still projects into the viewport.
    const p = project(b, { x: 0, y: 0, z: 0 });
    expect(p).not.toBeNull();
  });
});

describe("nodeGeom", () => {
  it("maps world rect to the ground plane and depth to elevation × explode", () => {
    const opts = {
      worldScale: 0.1,
      center: { x: 0, z: 0 },
      layerGap: 3,
      explode: 2,
      container: false,
    };
    const g = nodeGeom({ x: 10, y: 20, w: 100, h: 50 }, 2, opts);
    expect(g.x0).toBeCloseTo(1); // 10 × 0.1
    expect(g.z0).toBeCloseTo(2); // 20 × 0.1
    expect(g.w).toBeCloseTo(10);
    expect(g.d).toBeCloseTo(5);
    expect(g.y).toBeCloseTo(12); // depth 2 × gap 3 × explode 2
    expect(g.thick).toBeCloseTo(0.7); // leaf
  });

  it("uses a thin plate for containers", () => {
    const g = nodeGeom({ x: 0, y: 0, w: 100, h: 100 }, 0, {
      worldScale: 0.1,
      center: { x: 0, z: 0 },
      layerGap: 3,
      explode: 1,
      container: true,
    });
    expect(g.thick).toBeCloseTo(0.22);
    expect(g.y).toBe(0); // depth 0 sits on the floor
  });
});

describe("boxCorners", () => {
  it("returns 8 corners with the top face lifted by thickness", () => {
    const corners = boxCorners({ x0: 0, z0: 0, w: 2, d: 2, y: 5, thick: 1 });
    expect(corners).toHaveLength(8);
    expect(corners.slice(0, 4).every((c) => c.y === 5)).toBe(true); // bottom
    expect(corners.slice(4).every((c) => c.y === 6)).toBe(true); // top = y + thick
  });

  it("has 6 faces, one of them the top", () => {
    expect(BOX_FACES).toHaveLength(6);
    expect(BOX_FACES.filter((f) => f.kind === "top")).toHaveLength(1);
  });
});

describe("bezier", () => {
  it("hits the endpoints at t=0 and t=1 and lifts at the midpoint", () => {
    const a = { x: 0, y: 0, z: 0 };
    const c = { x: 1, y: 4, z: 0 };
    const b = { x: 2, y: 0, z: 0 };
    expect(bezier(a, c, b, 0)).toEqual(a);
    expect(bezier(a, c, b, 1)).toEqual(b);
    const mid = bezier(a, c, b, 0.5);
    expect(mid.x).toBeCloseTo(1);
    expect(mid.y).toBeGreaterThan(0); // arced up toward the control point
  });
});

describe("pointInPoly", () => {
  const square: [number, number][] = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ];
  it("detects inside vs outside", () => {
    expect(pointInPoly(5, 5, square)).toBe(true);
    expect(pointInPoly(15, 5, square)).toBe(false);
  });
});

describe("labelFontPx", () => {
  it("scales with projected width but clamps to [min,max]", () => {
    expect(labelFontPx(100, 0.1, 9, 20)).toBeCloseTo(10);
    expect(labelFontPx(10, 0.1, 9, 20)).toBe(9); // floored
    expect(labelFontPx(1000, 0.1, 9, 20)).toBe(20); // capped
  });
});

describe("colour helpers", () => {
  it("parses hex and shades within range", () => {
    expect(hexToRgb("#38bdf8")).toEqual({ r: 0x38, g: 0xbd, b: 0xf8 });
    expect(shade("#000000", 2, 0.5)).toBe("rgba(0,0,0,0.5)");
    expect(shade("#ffffff", 2, 1)).toBe("rgba(255,255,255,1)"); // clamped at 255
  });
});

describe("norm", () => {
  it("returns a unit vector", () => {
    const u = norm({ x: 3, y: 4, z: 0 });
    expect(Math.hypot(u.x, u.y, u.z)).toBeCloseTo(1);
  });
});
