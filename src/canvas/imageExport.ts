/**
 * Diagram → SVG image export (pure, framework-free).
 *
 * Builds a standalone SVG string from the layout rects + per-node visual
 * metadata (colour / icon / label, injected so this stays registry-free and
 * testable). Nodes render as rounded cards with a category-coloured accent;
 * containers as dashed translucent backplates drawn beneath their children.
 * Edges are straight connectors clipped to the node borders, with an arrowhead.
 *
 * PNG rasterisation (browser-only: <img> + <canvas>) lives in the UI layer; the
 * SVG produced here is what gets downloaded or rasterised.
 */
import type { ResourceInstance } from "../aws/model";
import type { Rect } from "./geometry";
import { boundsOf } from "./geometry";

export interface ImageEdge {
  from: string;
  to: string;
}

export interface ImageExportInputs {
  resources: readonly ResourceInstance[];
  edges: readonly ImageEdge[];
  rects: ReadonlyMap<string, Rect>;
  color: (serviceId: string) => string;
  icon: (serviceId: string) => string;
  label: (r: ResourceInstance) => string;
  isContainer: (id: string) => boolean;
}

export interface SvgOptions {
  padding?: number;
  background?: string;
}

const xmlEscape = (s: string) =>
  s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
  );

const center = (r: Rect) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

/** Point where the segment a→b crosses rect `r`'s border (for arrow clipping). */
function clipToRect(a: { x: number; y: number }, r: Rect): { x: number; y: number } {
  const c = center(r);
  const dx = a.x - c.x;
  const dy = a.y - c.y;
  if (dx === 0 && dy === 0) return c;
  const hw = r.w / 2;
  const hh = r.h / 2;
  // Scale the direction vector so it just reaches the rect's edge.
  const scale = Math.min(
    dx === 0 ? Infinity : hw / Math.abs(dx),
    dy === 0 ? Infinity : hh / Math.abs(dy),
  );
  return { x: c.x + dx * scale, y: c.y + dy * scale };
}

/** Truncate a label to fit the node width (rough monospace-ish estimate). */
function fit(text: string, width: number): string {
  const max = Math.max(3, Math.floor((width - 44) / 7.2));
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

/** Build a standalone SVG document for the diagram. Returns "" when empty. */
export function buildSvg(input: ImageExportInputs, opts: SvgOptions = {}): string {
  const { padding = 48, background = "#0a0f1e" } = opts;
  const byId = new Map(input.resources.map((r) => [r.id, r]));
  const drawn = input.resources.filter((r) => input.rects.has(r.id));
  if (drawn.length === 0) return "";

  const rectList = drawn.map((r) => input.rects.get(r.id)!);
  const bounds = boundsOf(rectList)!;
  const W = bounds.w + padding * 2;
  const H = bounds.h + padding * 2;
  const ox = padding - bounds.x;
  const oy = padding - bounds.y;

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(W)}" height="${Math.round(
      H,
    )}" viewBox="0 0 ${Math.round(W)} ${Math.round(H)}" font-family="ui-sans-serif, system-ui, sans-serif">`,
  );
  parts.push(
    `<defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#5b6b8c"/></marker></defs>`,
  );
  parts.push(`<rect width="100%" height="100%" fill="${background}"/>`);

  // Edges first (under nodes).
  for (const e of input.edges) {
    const ra = input.rects.get(e.from);
    const rb = input.rects.get(e.to);
    if (!ra || !rb || e.from === e.to) continue;
    const a = clipToRect(center(rb), ra);
    const b = clipToRect(center(ra), rb);
    parts.push(
      `<line x1="${(a.x + ox).toFixed(1)}" y1="${(a.y + oy).toFixed(1)}" x2="${(b.x + ox).toFixed(
        1,
      )}" y2="${(b.y + oy).toFixed(1)}" stroke="#3a4a6b" stroke-width="1.5" marker-end="url(#arrow)"/>`,
    );
  }

  // Containers beneath leaves so children render on top.
  const order = [...drawn].sort(
    (a, b) => Number(input.isContainer(b.id)) - Number(input.isContainer(a.id)),
  );
  for (const r of order) {
    const box = input.rects.get(r.id)!;
    const x = box.x + ox;
    const y = box.y + oy;
    const accent = input.color(r.serviceId);
    const container = input.isContainer(r.id);
    const name = fit(input.label(byId.get(r.id) ?? r), box.w);
    const icon = input.icon(r.serviceId);
    if (container) {
      parts.push(
        `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${box.w}" height="${box.h}" rx="12" fill="${accent}14" stroke="${accent}" stroke-width="1.5" stroke-dasharray="6 4"/>`,
      );
      parts.push(
        `<text x="${(x + 14).toFixed(1)}" y="${(y + 24).toFixed(1)}" fill="#e6edf7" font-size="13" font-weight="700">${xmlEscape(icon)} ${xmlEscape(name)}</text>`,
      );
    } else {
      parts.push(
        `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${box.w}" height="${box.h}" rx="14" fill="#0f1a31" stroke="#24406b" stroke-width="1"/>`,
      );
      parts.push(
        `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="4" height="${box.h}" rx="2" fill="${accent}"/>`,
      );
      parts.push(
        `<text x="${(x + 16).toFixed(1)}" y="${(y + box.h / 2 + 5).toFixed(1)}" fill="#e6edf7" font-size="14" font-weight="600">${xmlEscape(icon)}  ${xmlEscape(name)}</text>`,
      );
    }
  }

  parts.push("</svg>");
  return parts.join("");
}
