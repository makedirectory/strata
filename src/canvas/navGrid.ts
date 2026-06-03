/**
 * Spatial keyboard navigation over canvas nodes — pure and framework-free.
 *
 * The canvas is a 2-D plane, not a list, so "move selection right/down" is a
 * geometric query rather than an array step. Given the visible node rectangles
 * (in any consistent coordinate space) and the current node, these helpers pick
 * the most natural neighbour in a direction, and a stable reading order for
 * Home/End and the initial focus.
 */
export interface NavRect {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export type NavDir = "up" | "down" | "left" | "right";

interface Center {
  id: string;
  cx: number;
  cy: number;
}

const center = (r: NavRect): Center => ({ id: r.id, cx: r.x + r.w / 2, cy: r.y + r.h / 2 });

/**
 * Top-to-bottom, then left-to-right reading order. Rows are bucketed so nodes
 * that are roughly vertically aligned read left-to-right together rather than
 * strictly by pixel — `rowTolerance` is the vertical slack for "same row".
 */
export function readingOrder(rects: NavRect[], rowTolerance = 24): string[] {
  // Quantise each node to an integer row bucket so the comparator is a true
  // total order. A raw tolerance compare (|a.y-b.y|>tol ? … : a.x-b.x) is
  // non-transitive — three nodes in a diagonal band can form a cycle (A>B, B>C,
  // A<C), making the sort output depend on input permutation. `y` is the final
  // tiebreaker for determinism within a bucket.
  const row = (r: NavRect) => Math.round(r.y / rowTolerance);
  return [...rects].sort((a, b) => row(a) - row(b) || a.x - b.x || a.y - b.y).map((r) => r.id);
}

/**
 * The nearest node from `fromId` in `dir`, by centre geometry. Only nodes that
 * genuinely lie in that direction are considered; among them the closest along
 * the travel axis wins, with cross-axis drift as a tie-breaker (so moving
 * "right" prefers the node most directly to the right). Returns `null` when
 * there is nothing in that direction (or `fromId` isn't present).
 */
export function nextInDirection(rects: NavRect[], fromId: string, dir: NavDir): string | null {
  const centers = rects.map(center);
  const from = centers.find((c) => c.id === fromId);
  if (!from) return null;

  const horizontal = dir === "left" || dir === "right";
  const sign = dir === "right" || dir === "down" ? 1 : -1;

  let best: Center | null = null;
  let bestScore = Infinity;
  for (const c of centers) {
    if (c.id === fromId) continue;
    const along = horizontal ? c.cx - from.cx : c.cy - from.cy;
    const cross = horizontal ? c.cy - from.cy : c.cx - from.cx;
    // Must be on the correct side, with a small dead-zone so near-aligned nodes
    // on the perpendicular axis aren't claimed by the wrong direction.
    if (sign > 0 ? along <= 1 : along >= -1) continue;
    // Travel distance dominates; cross-axis offset is penalised so we favour the
    // node most directly in line with the travel direction.
    const score = Math.abs(along) + Math.abs(cross) * 2;
    if (score < bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best ? best.id : null;
}
