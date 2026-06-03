/**
 * Pure canvas geometry — framework-free math for the infinite transform plane.
 *
 * Everything the canvas needs that is *just numbers* lives here so it can be
 * unit-tested without React/DOM: cursor-anchored zoom, fit-to-view, snap +
 * alignment guides, marquee hit-testing and the minimap ↔ world mapping.
 *
 * Coordinate conventions (mirror the rest of the canvas):
 * - A world point `w` renders at canvas-wrap-LOCAL `pan.x + w*pan.scale`.
 * - `screenToWorld` therefore expects canvas-wrap-local input (the caller must
 *   subtract the `.canvas-wrap` bounding rect first, as the drop handler does).
 */
import type { Viewport } from "../aws/model";
import type { CanvasDensity, LodTier } from "../types";

export interface Vec2 {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A positioned node box on the world plane (top-left origin). */
export interface NodeBox extends Rect {
  id: string;
}

// ---- scale -----------------------------------------------------------------

/** Interactive zoom bounds. `fitView` may dip below `MIN_SCALE` for big graphs. */
export const MIN_SCALE = 0.1;
export const MAX_SCALE = 4;

/** Visible grid step (world units) — snapping targets this so it matches paint. */
export const GRID_STEP = 16;

export function clampScale(scale: number, min = MIN_SCALE, max = MAX_SCALE): number {
  return Math.min(max, Math.max(min, scale));
}

/**
 * Click-vs-drag threshold in SCREEN pixels (zoom-independent). A press that
 * moves less than this records no drag → no history entry / no dirty flag. Both
 * the node interaction layer and the annotation overlay share this value so the
 * two layers feel identical.
 */
export const DRAG_THRESHOLD_PX = 3;

// ---- pan / zoom ------------------------------------------------------------

/** Canvas-wrap-local point → world coordinates. */
export function screenToWorld(point: Vec2, pan: Viewport): Vec2 {
  return { x: (point.x - pan.x) / pan.scale, y: (point.y - pan.y) / pan.scale };
}

/**
 * World coordinates → canvas-wrap-local point. The EXACT inverse of
 * {@link screenToWorld}: solving `worldX = (sx - pan.x) / pan.scale` for `sx`
 * gives `sx = worldX * pan.scale + pan.x`. This is the single source of truth
 * for the forward (world→screen) projection used by every absolutely-positioned
 * overlay (accessible nodes, annotations, markers).
 */
export function worldToScreen(point: Vec2, pan: Viewport): Vec2 {
  return { x: point.x * pan.scale + pan.x, y: point.y * pan.scale + pan.y };
}

/**
 * Convert a SCREEN-pixel delta into a WORLD-unit delta at the given scale. Drag
 * math (node move/resize, annotation move/resize) is decided in screen pixels
 * but applied in world units; this is the one conversion both layers share.
 */
export function screenDeltaToWorld(dxScreen: number, dyScreen: number, scale: number): Vec2 {
  return { x: dxScreen / scale, y: dyScreen / scale };
}

/** Round a single world coordinate to the nearest grid step. */
export function snapToGrid(value: number, step = GRID_STEP): number {
  return Math.round(value / step) * step;
}

/**
 * Zoom to `nextScale` while keeping the world point currently under `point`
 * (a canvas-wrap-local coordinate) fixed on screen. This is the one primitive
 * behind cursor-anchored wheel zoom, the +/- buttons (anchor = viewport
 * centre) and the 100% reset (nextScale = 1, anchor = centre).
 */
export function zoomAbout(pan: Viewport, point: Vec2, nextScale: number): Viewport {
  const scale = clampScale(nextScale);
  const worldX = (point.x - pan.x) / pan.scale;
  const worldY = (point.y - pan.y) / pan.scale;
  return { x: point.x - worldX * scale, y: point.y - worldY * scale, scale };
}

/** Multiply the current scale by `factor`, anchored at `point`. */
export function zoomByFactor(pan: Viewport, point: Vec2, factor: number): Viewport {
  return zoomAbout(pan, point, pan.scale * factor);
}

// ---- rectangles ------------------------------------------------------------

/** Rectangle from two corner points, in any drag direction. */
export function normalizeRect(a: Vec2, b: Vec2): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  };
}

/** Smallest rect covering both inputs. */
export function unionRect(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const right = Math.max(a.x + a.w, b.x + b.w);
  const bottom = Math.max(a.y + a.h, b.y + b.h);
  return { x, y, w: right - x, h: bottom - y };
}

/** True when two rects overlap (touching edges do not count). */
export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** Grow a rect by `margin` on every side. */
export function expandRect(r: Rect, margin: number): Rect {
  return { x: r.x - margin, y: r.y - margin, w: r.w + margin * 2, h: r.h + margin * 2 };
}

/**
 * The point on rect `r`'s border where the segment from the rect centre toward
 * `toward` (an external point) exits the rectangle. Used to anchor callout
 * leader lines to the visible box edge instead of its centre, so the line stays
 * attached when the bubble grows. Scale the centre→toward vector by the larger
 * of `|dx|/(w/2)` and `|dy|/(h/2)` (the axis that hits an edge first); a
 * degenerate (zero) rect or a `toward` at the centre returns the centre.
 */
export function rectEdgeTowards(r: Rect, toward: Vec2): Vec2 {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const dx = toward.x - cx;
  const dy = toward.y - cy;
  const hw = r.w / 2;
  const hh = r.h / 2;
  if (hw <= 0 || hh <= 0 || (dx === 0 && dy === 0)) return { x: cx, y: cy };
  const scale = Math.max(Math.abs(dx) / hw, Math.abs(dy) / hh);
  if (scale === 0) return { x: cx, y: cy };
  return { x: cx + dx / scale, y: cy + dy / scale };
}

export interface GridPackItem {
  id: string;
  w: number;
  h: number;
}
export interface GridPackOptions {
  originX?: number;
  originY?: number;
  gap?: number;
  /** Columns; defaults to a square-ish ceil(sqrt(n)). */
  cols?: number;
}

/**
 * Flow-pack items into a tidy grid (rows of `cols`), returning a top-left for
 * each. Used by "Tidy" to arrange top-level nodes; row height tracks the
 * tallest item in the row so mixed sizes don't overlap.
 */
export function gridPack(
  items: readonly GridPackItem[],
  opts: GridPackOptions = {},
): Array<{ id: string; x: number; y: number }> {
  const { originX = 80, originY = 80, gap = 40, cols } = opts;
  if (items.length === 0) return [];
  const c = cols && cols > 0 ? cols : Math.max(1, Math.ceil(Math.sqrt(items.length)));
  const out: Array<{ id: string; x: number; y: number }> = [];
  let x = originX;
  let y = originY;
  let rowH = 0;
  items.forEach((it, i) => {
    if (i > 0 && i % c === 0) {
      y += rowH + gap;
      x = originX;
      rowH = 0;
    }
    out.push({ id: it.id, x, y });
    x += it.w + gap;
    rowH = Math.max(rowH, it.h);
  });
  return out;
}

/** Bounding box of a set of rects, or null when empty. */
export function boundsOf(rects: readonly Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let minx = Infinity;
  let miny = Infinity;
  let maxx = -Infinity;
  let maxy = -Infinity;
  for (const r of rects) {
    minx = Math.min(minx, r.x);
    miny = Math.min(miny, r.y);
    maxx = Math.max(maxx, r.x + r.w);
    maxy = Math.max(maxy, r.y + r.h);
  }
  return { x: minx, y: miny, w: maxx - minx, h: maxy - miny };
}

// ---- fit to view -----------------------------------------------------------

export interface FitOptions {
  margin?: number;
  minScale?: number;
  maxScale?: number;
}

/**
 * Viewport that frames `bounds` (world rect) inside a `view` (canvas-wrap pixel
 * size), centred with a margin. `minScale` defaults below `MIN_SCALE` so very
 * large graphs can still be framed.
 */
export function fitView(
  bounds: Rect,
  view: { width: number; height: number },
  opts: FitOptions = {},
): Viewport {
  const { margin = 80, minScale = 0.05, maxScale = 1.6 } = opts;
  const worldW = Math.max(1, bounds.w);
  const worldH = Math.max(1, bounds.h);
  const sx = (view.width - margin * 2) / worldW;
  const sy = (view.height - margin * 2) / worldH;
  const scale = Math.max(minScale, Math.min(maxScale, Math.min(sx, sy)));
  const x = (view.width - worldW * scale) / 2 - bounds.x * scale;
  const y = (view.height - worldH * scale) / 2 - bounds.y * scale;
  return { x, y, scale };
}

// ---- snap + alignment guides ----------------------------------------------

/** A transient alignment guide drawn while dragging, in world coordinates. */
export interface GuideLine {
  /** "x" → vertical line at world x = `pos`; "y" → horizontal line at world y = `pos`. */
  axis: "x" | "y";
  pos: number;
  /** Extent of the line along the perpendicular axis (world units). */
  from: number;
  to: number;
}

export interface SnapResult {
  x: number;
  y: number;
  guides: GuideLine[];
}

export interface SnapOptions {
  gridStep?: number;
  /** Alignment threshold in WORLD units (callers usually pass screenPx / scale). */
  threshold?: number;
}

interface AxisCandidate {
  delta: number;
  pos: number;
  other: Rect;
}

/** Edge positions of a box along one axis: near edge, centre, far edge. */
function axisEdges(start: number, size: number): number[] {
  return [start, start + size / 2, start + size];
}

/**
 * Snap a dragged box's proposed top-left (`x`,`y`) to nearby node alignments,
 * falling back to the visible grid per-axis when nothing aligns.
 *
 * Alignment wins over the grid because it is the more specific intent: when any
 * of the dragged box's left/centre/right (or top/centre/bottom) edges land
 * within `threshold` of another node's matching edge, we snap that axis to the
 * other node and emit a guide line. Otherwise the axis snaps to `gridStep`.
 */
export function computeSnap(
  dragged: Rect,
  others: readonly Rect[],
  opts: SnapOptions = {},
): SnapResult {
  const { gridStep = GRID_STEP, threshold = 8 } = opts;
  const guides: GuideLine[] = [];

  const snapAxis = (
    start: number,
    size: number,
    otherStart: (o: Rect) => number,
    otherSize: (o: Rect) => number,
  ): { value: number; match: Rect | null } => {
    const edges = axisEdges(start, size);
    let best: AxisCandidate | null = null;
    for (const o of others) {
      const oEdges = axisEdges(otherStart(o), otherSize(o));
      for (const e of edges) {
        for (const oe of oEdges) {
          const delta = oe - e;
          if (Math.abs(delta) <= threshold && (!best || Math.abs(delta) < Math.abs(best.delta))) {
            best = { delta, pos: oe, other: o };
          }
        }
      }
    }
    if (best) return { value: start + best.delta, match: best.other };
    return { value: Math.round(start / gridStep) * gridStep, match: null };
  };

  const xr = snapAxis(
    dragged.x,
    dragged.w,
    (o) => o.x,
    (o) => o.w,
  );
  const yr = snapAxis(
    dragged.y,
    dragged.h,
    (o) => o.y,
    (o) => o.h,
  );

  const snapped: Rect = { x: xr.value, y: yr.value, w: dragged.w, h: dragged.h };

  if (xr.match) {
    // Vertical guide: span the perpendicular (y) extent of both boxes.
    const from = Math.min(snapped.y, xr.match.y);
    const to = Math.max(snapped.y + snapped.h, xr.match.y + xr.match.h);
    // The aligned x can be any of the matched box's edges nearest a dragged edge.
    const pos = nearestEdgePos(axisEdges(snapped.x, snapped.w), axisEdges(xr.match.x, xr.match.w));
    guides.push({ axis: "x", pos, from, to });
  }
  if (yr.match) {
    const from = Math.min(snapped.x, yr.match.x);
    const to = Math.max(snapped.x + snapped.w, yr.match.x + yr.match.w);
    const pos = nearestEdgePos(axisEdges(snapped.y, snapped.h), axisEdges(yr.match.y, yr.match.h));
    guides.push({ axis: "y", pos, from, to });
  }

  return { x: snapped.x, y: snapped.y, guides };
}

/** The other-box edge position closest to any dragged edge (the line we drew to). */
function nearestEdgePos(edges: number[], otherEdges: number[]): number {
  let bestPos = otherEdges[0];
  let bestDist = Infinity;
  for (const e of edges) {
    for (const oe of otherEdges) {
      const d = Math.abs(oe - e);
      if (d < bestDist) {
        bestDist = d;
        bestPos = oe;
      }
    }
  }
  return bestPos;
}

// ---- marquee ---------------------------------------------------------------

/** Ids of boxes fully enclosed by `rect` (world coordinates). */
export function nodesInRect(boxes: readonly NodeBox[], rect: Rect): string[] {
  const right = rect.x + rect.w;
  const bottom = rect.y + rect.h;
  return boxes
    .filter((b) => b.x >= rect.x && b.y >= rect.y && b.x + b.w <= right && b.y + b.h <= bottom)
    .map((b) => b.id);
}

// ---- minimap ---------------------------------------------------------------

/** The world rectangle currently visible given a pan/zoom and view size. */
export function viewportWorldRect(pan: Viewport, view: { width: number; height: number }): Rect {
  return {
    x: -pan.x / pan.scale,
    y: -pan.y / pan.scale,
    w: view.width / pan.scale,
    h: view.height / pan.scale,
  };
}

export interface MinimapTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
  originX: number;
  originY: number;
}

/**
 * Fit `content` (node bbox, or null when empty) AND the current `viewport`
 * rectangle inside the minimap canvas, so the viewport indicator is always
 * visible even when panned away from the nodes.
 */
export function minimapTransform(
  content: Rect | null,
  viewport: Rect,
  dims: { w: number; h: number },
  pad = 6,
): MinimapTransform {
  const union = content ? unionRect(content, viewport) : viewport;
  const innerW = dims.w - pad * 2;
  const innerH = dims.h - pad * 2;
  const scale = Math.min(innerW / Math.max(1, union.w), innerH / Math.max(1, union.h));
  const offsetX = pad + (innerW - union.w * scale) / 2;
  const offsetY = pad + (innerH - union.h * scale) / 2;
  return { scale, offsetX, offsetY, originX: union.x, originY: union.y };
}

export function worldToMinimap(t: MinimapTransform, p: Vec2): Vec2 {
  return { x: t.offsetX + (p.x - t.originX) * t.scale, y: t.offsetY + (p.y - t.originY) * t.scale };
}

export function minimapToWorld(t: MinimapTransform, mp: Vec2): Vec2 {
  return {
    x: t.originX + (mp.x - t.offsetX) / t.scale,
    y: t.originY + (mp.y - t.offsetY) / t.scale,
  };
}

/**
 * Pan that centres `worldPoint` in a `view` at the given `scale` — used when a
 * minimap click/drag should bring a world location to the middle of the canvas.
 */
export function panToCenter(
  worldPoint: Vec2,
  view: { width: number; height: number },
  scale: number,
): Viewport {
  return {
    x: view.width / 2 - worldPoint.x * scale,
    y: view.height / 2 - worldPoint.y * scale,
    scale,
  };
}

// ---- semantic level-of-detail --------------------------------------------

/** Effective-scale thresholds for LOD tier boundaries. */
export const LOD_FAR_BELOW = 0.4;
export const LOD_MID_BELOW = 0.75;

/** Compact-mode and reduced-tier node heights (world units). */
export const COMPACT_NEAR_HEIGHT = 64;
export const MID_HEIGHT = 48;
export const FAR_HEIGHT = 34;

/**
 * Pick the level-of-detail tier from the effective zoom scale. Far → render a
 * minimal card (icon + name); mid → icon + name + one pill; near → full card.
 */
export function lodTier(scale: number): LodTier {
  if (scale < LOD_FAR_BELOW) return "far";
  if (scale < LOD_MID_BELOW) return "mid";
  return "near";
}

/**
 * Rendered height for a node at a given tier/density. The near tier honours the
 * node's base height (full card) in Comfortable and a trimmed height in Compact;
 * mid/far collapse to fixed short cards. Edges use the same value so wires stay
 * attached to the visible card.
 */
export function nodeRenderHeight(tier: LodTier, density: CanvasDensity, baseH: number): number {
  if (tier === "far") return FAR_HEIGHT;
  if (tier === "mid") return MID_HEIGHT;
  return density === "compact" ? COMPACT_NEAR_HEIGHT : baseH;
}
