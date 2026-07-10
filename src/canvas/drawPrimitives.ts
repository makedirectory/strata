/**
 * Shared drawing primitives — pure geometry/text helpers used by BOTH the SVG
 * image export (`imageExport.ts`) and the on-screen canvas draw layer
 * (`canvasScene.ts`).
 *
 * The renderer-scale spec's core invariant is "don't fork the visual language":
 * the shareable export and the on-screen render must not drift. Anything that is
 * *just geometry or text measurement* — label truncation, where an edge meets a
 * node's border, arrowhead points — lives here so a single definition feeds both
 * painters. Colour/icon still come from the registry; nothing here reads it.
 *
 * Pure: no DOM, no canvas, no registry — trivially unit-testable.
 */
import type { Rect, Vec2 } from "./geometry";
import { rectEdgeTowards } from "./geometry";

/** Centre point of a rect. */
export function rectCenter(r: Rect): Vec2 {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

/**
 * The point on rect `r`'s border where the segment from the rect centre toward
 * `from` (an external point, typically the other node's centre) exits — i.e.
 * where an edge should visually attach. Thin wrapper over the geometry helper so
 * both painters clip edges identically. (`rectEdgeTowards` and the old
 * export-only `clipToRect` are algebraically the same point.)
 */
export function edgeAnchor(r: Rect, from: Vec2): Vec2 {
  return rectEdgeTowards(r, from);
}

/**
 * Truncate a label to fit `width` (world/px units), appending an ellipsis when
 * clipped. `reserve` is space taken by the leading icon + padding; `charW` is the
 * rough per-character advance. These defaults reproduce the historical
 * `imageExport` fit exactly so the shared export stays byte-identical.
 */
export function fitLabel(text: string, width: number, reserve = 44, charW = 7.2): string {
  const max = Math.max(3, Math.floor((width - reserve) / charW));
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

/** The three points of a triangular arrowhead at `tip`, pointing along dir→tip. */
export interface Arrowhead {
  tip: Vec2;
  left: Vec2;
  right: Vec2;
}

/**
 * Arrowhead polygon for an edge ending at `tip`, arriving from `from`. `size` is
 * the arrow length; `spread` the half-width at the base. Returns the tip plus the
 * two base corners so either painter can fill the same triangle.
 */
export function arrowhead(from: Vec2, tip: Vec2, size = 8, spread = 4): Arrowhead {
  const dx = tip.x - from.x;
  const dy = tip.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  // Perpendicular unit vector.
  const px = -uy;
  const py = ux;
  const baseX = tip.x - ux * size;
  const baseY = tip.y - uy * size;
  return {
    tip,
    left: { x: baseX + px * spread, y: baseY + py * spread },
    right: { x: baseX - px * spread, y: baseY - py * spread },
  };
}
