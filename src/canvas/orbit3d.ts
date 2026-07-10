/**
 * Pure software-3D math for the orbit view (Mode B of the renderer-scale spec).
 *
 * The orbit view reprojects the SAME pure layout every other renderer uses:
 * a node's world rect maps to the ground plane (`worldX → X`, `worldY → Z`) and
 * its containment `depth` becomes elevation (`Y = depth × layerGap × explode`).
 * Nothing new is computed here — it's a camera + projection + box tessellation
 * over `computeLayout`'s output. All of it is pure and framework-free so the
 * projection, depth→elevation mapping, picking and label-size clamp are
 * unit-testable without a canvas. (Reference spike:
 * specs/prototypes/renderer-3d-orbit.html.)
 */
import type { Rect } from "./geometry";

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const scl = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
export const len = (a: Vec3): number => Math.sqrt(dot(a, a));
export const norm = (a: Vec3): Vec3 => {
  const l = len(a) || 1;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
};

/** Orbit camera: a target point plus azimuth/elevation/distance (spherical). */
export interface OrbitCamera {
  target: Vec3;
  az: number;
  el: number;
  dist: number;
  /** Vertical field of view, radians. */
  fov: number;
}

export interface CameraBasis {
  eye: Vec3;
  right: Vec3;
  up: Vec3;
  fwd: Vec3;
  focal: number;
  W: number;
  H: number;
}

/** Build the view basis (eye + orthonormal axes + focal length) for a camera. */
export function buildCameraBasis(cam: OrbitCamera, W: number, H: number): CameraBasis {
  const dir = {
    x: Math.cos(cam.el) * Math.sin(cam.az),
    y: Math.sin(cam.el),
    z: Math.cos(cam.el) * Math.cos(cam.az),
  };
  const eye = add(cam.target, scl(dir, cam.dist));
  const fwd = norm(sub(cam.target, eye));
  const right = norm(cross(fwd, { x: 0, y: 1, z: 0 }));
  const up = cross(right, fwd);
  const focal = H / 2 / Math.tan(cam.fov / 2);
  return { eye, right, up, fwd, focal, W, H };
}

export interface Projected {
  sx: number;
  sy: number;
  /** Camera-space depth (distance along fwd); >0 means in front of the camera. */
  z: number;
}

/** Perspective-project a world point to screen, or null if behind the camera. */
export function project(basis: CameraBasis, p: Vec3): Projected | null {
  const rel = sub(p, basis.eye);
  const z = dot(rel, basis.fwd);
  if (z <= 0.05) return null;
  const x = dot(rel, basis.right);
  const y = dot(rel, basis.up);
  return {
    sx: basis.W / 2 + (x / z) * basis.focal,
    sy: basis.H / 2 - (y / z) * basis.focal,
    z,
  };
}

/** A node's 3D box footprint on the ground plane + its elevation & thickness. */
export interface Box3 {
  x0: number;
  z0: number;
  w: number;
  d: number;
  y: number;
  thick: number;
}

export interface GeomOptions {
  worldScale: number;
  center: { x: number; z: number };
  layerGap: number;
  explode: number;
  container: boolean;
}

/** Map a world rect + depth to its 3D box (depth → elevation). */
export function nodeGeom(rect: Rect, depth: number, opts: GeomOptions): Box3 {
  const { worldScale, center, layerGap, explode, container } = opts;
  return {
    x0: (rect.x - center.x) * worldScale,
    z0: (rect.y - center.z) * worldScale,
    w: rect.w * worldScale,
    d: rect.h * worldScale,
    y: depth * layerGap * explode,
    thick: container ? 0.22 : 0.7,
  };
}

/** The 8 corners of a box: indices 0–3 bottom face, 4–7 top face. */
export function boxCorners(g: Box3): Vec3[] {
  const { x0, z0, w, d, y, thick } = g;
  const y1 = y + thick;
  return [
    { x: x0, y, z: z0 },
    { x: x0 + w, y, z: z0 },
    { x: x0 + w, y, z: z0 + d },
    { x: x0, y, z: z0 + d },
    { x: x0, y: y1, z: z0 },
    { x: x0 + w, y: y1, z: z0 },
    { x: x0 + w, y: y1, z: z0 + d },
    { x: x0, y: y1, z: z0 + d },
  ];
}

export interface BoxFace {
  idx: [number, number, number, number];
  n: Vec3;
  kind: "top" | "bottom" | "side";
}

/** The 6 faces of a box as corner-index quads + outward normals. */
export const BOX_FACES: readonly BoxFace[] = [
  { idx: [4, 5, 6, 7], n: { x: 0, y: 1, z: 0 }, kind: "top" },
  { idx: [0, 3, 2, 1], n: { x: 0, y: -1, z: 0 }, kind: "bottom" },
  { idx: [0, 1, 5, 4], n: { x: 0, y: 0, z: -1 }, kind: "side" },
  { idx: [2, 3, 7, 6], n: { x: 0, y: 0, z: 1 }, kind: "side" },
  { idx: [1, 2, 6, 5], n: { x: 1, y: 0, z: 0 }, kind: "side" },
  { idx: [3, 0, 4, 7], n: { x: -1, y: 0, z: 0 }, kind: "side" },
];

/** Quadratic Bézier point at `t` (edges arc up between node tops). */
export function bezier(a: Vec3, c: Vec3, b: Vec3, t: number): Vec3 {
  const u = 1 - t;
  return {
    x: u * u * a.x + 2 * u * t * c.x + t * t * b.x,
    y: u * u * a.y + 2 * u * t * c.y + t * t * b.y,
    z: u * u * a.z + 2 * u * t * c.z + t * t * b.z,
  };
}

/** Point-in-polygon (even-odd rule) for screen-space top-face picking. */
export function pointInPoly(
  px: number,
  py: number,
  poly: ReadonlyArray<[number, number]>,
): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0];
    const yi = poly[i][1];
    const xj = poly[j][0];
    const yj = poly[j][1];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Label font size derived from a node's projected on-screen width, so text
 * scales with the geometry as the camera moves but never gets illegibly small or
 * cartoonishly large (the spec's fix for the spike's fixed-size labels).
 */
export function labelFontPx(projectedWidthPx: number, k = 0.12, min = 9, max = 20): number {
  return Math.max(min, Math.min(max, projectedWidthPx * k));
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Parse a "#rrggbb" hex colour to RGB (0–255). */
export function hexToRgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** Multiply a hex colour's channels by `f` (Lambert shading) → rgba() string. */
export function shade(hex: string, f: number, alpha = 1): string {
  const c = hexToRgb(hex);
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return `rgba(${clamp(c.r * f)},${clamp(c.g * f)},${clamp(c.b * f)},${alpha})`;
}
