/**
 * Canvas draw layer — scene building + painting (Mode A of the renderer-scale
 * spec). This is the imperative `<canvas>` 2D alternative to the DOM-per-node
 * structural render, kept behind a flag until it reaches parity.
 *
 * Split in two so the logic is testable without a real canvas:
 *  - {@link buildCanvasScene} is PURE — it culls to the viewport, splits
 *    containers from leaves, orders containers by containment depth, and resolves
 *    edge endpoints. No canvas, no registry (colour/icon are passed in already
 *    resolved, honouring "the renderer never forks the palette").
 *  - {@link paintScene} executes the scene against a `CanvasRenderingContext2D`,
 *    reusing the SAME `drawPrimitives` (edge anchors, arrowheads, label fit) as
 *    the SVG export so the two can't visually drift.
 */
import type { Rect, Vec2 } from "./geometry";
import type { Viewport } from "../aws/model";
import { rectsIntersect, worldToScreen } from "./geometry";
import { rectCenter, edgeAnchor, arrowhead, fitLabel } from "./drawPrimitives";

/** A node ready to paint: world rect + registry-resolved visual metadata. */
export interface SceneNode {
  id: string;
  rect: Rect;
  /** Containment depth from `computeLayout.depth` (0 = root). */
  depth: number;
  isContainer: boolean;
  /** Category accent colour (from `serviceColor`). */
  color: string;
  /** Icon glyph (from `serviceIcon`). */
  icon: string;
  label: string;
  selected: boolean;
}

/** A resolved edge: the two endpoint world rects. */
export interface SceneEdge {
  from: Rect;
  to: Rect;
}

/** An ordered, culled scene ready for {@link paintScene}. */
export interface CanvasScene {
  /** Container backplates, shallow→deep (drawn back-to-front, beneath leaves). */
  containers: SceneNode[];
  /** Leaf cards, drawn on top of backplates. */
  leaves: SceneNode[];
  edges: SceneEdge[];
}

/**
 * Build the (culled, ordered) scene. `cull` is the viewport world rect; omit or
 * pass null to include everything. Edges are kept only when BOTH endpoints are in
 * the visible set, so off-screen wires cost nothing.
 */
export function buildCanvasScene(
  nodes: readonly SceneNode[],
  relationships: readonly { from: string; to: string }[],
  cull?: Rect | null,
): CanvasScene {
  const visible = new Map<string, SceneNode>();
  const containers: SceneNode[] = [];
  const leaves: SceneNode[] = [];
  for (const n of nodes) {
    if (cull && !rectsIntersect(n.rect, cull)) continue;
    visible.set(n.id, n);
    if (n.isContainer) containers.push(n);
    else leaves.push(n);
  }
  // Outer containers first so nested backplates paint on top of their parents.
  containers.sort((a, b) => a.depth - b.depth);

  const edges: SceneEdge[] = [];
  for (const rel of relationships) {
    if (rel.from === rel.to) continue;
    const a = visible.get(rel.from);
    const b = visible.get(rel.to);
    if (a && b) edges.push({ from: a.rect, to: b.rect });
  }
  return { containers, leaves, edges };
}

/** Options controlling how {@link paintScene} projects and styles. */
export interface PaintOptions {
  /** Device pixel ratio the backing store was sized to. */
  dpr: number;
  /** CSS width/height of the canvas element. */
  cssWidth: number;
  cssHeight: number;
}

// Visual constants mirror the SVG export vocabulary (imageExport.ts).
const LEAF_FILL = "#0f1a31";
const LEAF_STROKE = "#24406b";
const LABEL_FILL = "#e6edf7";
const EDGE_STROKE = "#3a4a6b";
const ARROW_FILL = "#5b6b8c";
const SELECT_RING = "#38bdf8";

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(x, y, w, h, rr);
  } else {
    // Fallback for environments without roundRect (older canvas / test mocks).
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }
}

function line(ctx: CanvasRenderingContext2D, a: Vec2, b: Vec2): void {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

function fillTriangle(ctx: CanvasRenderingContext2D, a: Vec2, b: Vec2, c: Vec2): void {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.lineTo(c.x, c.y);
  ctx.closePath();
  ctx.fill();
}

/**
 * Paint `scene` onto `ctx` at the given `viewport`. Draws back-to-front: edges,
 * container backplates, leaf cards, selection rings. Coordinates are projected
 * world→screen via the shared `worldToScreen`, so the canvas and the DOM/a11y
 * overlays stay pixel-aligned. The caller is responsible for sizing the backing
 * store; this clears and repaints the full frame.
 */
export function paintScene(
  ctx: CanvasRenderingContext2D,
  scene: CanvasScene,
  viewport: Viewport,
  opts: PaintOptions,
): void {
  const { dpr, cssWidth, cssHeight } = opts;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);

  const project = (r: Rect) => {
    const p = worldToScreen({ x: r.x, y: r.y }, viewport);
    return { x: p.x, y: p.y, w: r.w * viewport.scale, h: r.h * viewport.scale };
  };

  // 1. Edges (under everything), clipped to node borders with an arrowhead.
  ctx.strokeStyle = EDGE_STROKE;
  ctx.lineWidth = 1.5;
  for (const e of scene.edges) {
    const a = worldToScreen(edgeAnchor(e.from, rectCenter(e.to)), viewport);
    const b = worldToScreen(edgeAnchor(e.to, rectCenter(e.from)), viewport);
    line(ctx, a, b);
    const head = arrowhead(a, b);
    ctx.fillStyle = ARROW_FILL;
    fillTriangle(ctx, head.tip, head.left, head.right);
  }

  // 2. Container backplates (dashed, translucent), shallow→deep.
  for (const c of scene.containers) {
    const s = project(c.rect);
    ctx.save();
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = c.color;
    ctx.lineWidth = 1.5;
    ctx.fillStyle = c.color + "14"; // ~8% alpha, matching the SVG export
    roundRectPath(ctx, s.x, s.y, s.w, s.h, 12);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    paintLabel(ctx, c, s.x + 14, s.y + 24, s.w);
  }

  // 3. Leaf cards.
  for (const n of scene.leaves) {
    const s = project(n.rect);
    ctx.fillStyle = LEAF_FILL;
    ctx.strokeStyle = LEAF_STROKE;
    ctx.lineWidth = 1;
    roundRectPath(ctx, s.x, s.y, s.w, s.h, 14);
    ctx.fill();
    ctx.stroke();
    // Accent bar.
    ctx.fillStyle = n.color;
    roundRectPath(ctx, s.x, s.y, 4, s.h, 2);
    ctx.fill();
    paintLabel(ctx, n, s.x + 16, s.y + s.h / 2 + 5, s.w);
  }

  // 4. Selection rings on top.
  ctx.strokeStyle = SELECT_RING;
  ctx.lineWidth = 2;
  for (const n of [...scene.containers, ...scene.leaves]) {
    if (!n.selected) continue;
    const s = project(n.rect);
    roundRectPath(ctx, s.x - 2, s.y - 2, s.w + 4, s.h + 4, 14);
    ctx.stroke();
  }
}

function paintLabel(
  ctx: CanvasRenderingContext2D,
  n: SceneNode,
  x: number,
  y: number,
  boxWidth: number,
): void {
  const text = `${n.icon}  ${fitLabel(n.label, boxWidth)}`;
  ctx.fillStyle = LABEL_FILL;
  ctx.font = `${n.isContainer ? "700" : "600"} 14px ui-sans-serif, system-ui, sans-serif`;
  ctx.textBaseline = "alphabetic";
  ctx.fillText(text, x, y);
}
