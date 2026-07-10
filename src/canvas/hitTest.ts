/**
 * Pure spatial hit-testing for the canvas draw layer.
 *
 * The DOM renderer relies on per-node event listeners; the canvas draw layer has
 * no DOM nodes, so pointer picking becomes a spatial lookup over the layout
 * rects. This is that lookup — pure and framework-free so it's unit-testable
 * without a real canvas. Selection, hover, double-click-to-focus and drag-start
 * all route through {@link hitTest}.
 */
import type { Rect } from "./geometry";

/** A pickable node: its world rect and containment depth (0 = root). */
export interface HitNode {
  id: string;
  rect: Rect;
  /** Containment nesting level from `computeLayout.depth` (deeper wins). */
  depth: number;
}

/** True when world point `p` lies within `r` (edges inclusive). */
export function rectContains(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

/**
 * The topmost node id at world point (`x`,`y`), or `null` if none. "Topmost" =
 * the deepest containment level (a child wins over the container it sits in);
 * ties break to the later node in `nodes` (drawn last / on top). This mirrors the
 * paint order so picking matches what the eye sees.
 */
export function hitTest(nodes: readonly HitNode[], x: number, y: number): string | null {
  let best: HitNode | null = null;
  for (const n of nodes) {
    if (!rectContains(n.rect, x, y)) continue;
    if (!best || n.depth >= best.depth) best = n;
  }
  return best ? best.id : null;
}
