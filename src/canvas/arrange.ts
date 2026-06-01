/**
 * Relationship-aware auto-arrange — pure, framework-free.
 *
 * Lays the TOP-LEVEL nodes out left-to-right in dependency order: a longest-path
 * layering turns the relationship graph into columns (tiers) so flow reads
 * naturally (e.g. edge → compute → data). Children are NOT positioned here — the
 * containment layout engine owns them; we only need each root's subtree size to
 * pack columns without overlap. Disconnected roots are grid-packed below the
 * layered block so a sparse canvas still tidies up.
 *
 * Pure: runs its own `computeLayout` pass for sizing, so it works at load time
 * (before the live React layout has been recomputed) — which is what lets
 * templates open already-arranged.
 */
import type { ResourceInstance, Relationship } from "../aws/model";
import { computeLayout, DEFAULT_LEAF_W, DEFAULT_LEAF_H } from "./layout";
import { gridPack } from "./geometry";

export interface ArrangeOptions {
  originX?: number;
  originY?: number;
  /** Horizontal gap between tiers (columns). */
  gapX?: number;
  /** Vertical gap between nodes within a tier. */
  gapY?: number;
}

export interface ArrangedPosition {
  id: string;
  x: number;
  y: number;
}

const GRID = 16;
const snap = (v: number) => Math.round(v / GRID) * GRID;

/**
 * Compute tidy top-level positions for `resources`, layered by `relationships`.
 * Returns one entry per top-level node (children are layout-owned, omitted).
 */
export function arrangeTiered(
  resources: readonly ResourceInstance[],
  relationships: readonly Relationship[],
  isContainer: (r: ResourceInstance) => boolean,
  opts: ArrangeOptions = {},
): ArrangedPosition[] {
  const { originX = 80, originY = 80, gapX = 80, gapY = 48 } = opts;
  if (resources.length === 0) return [];

  // Subtree footprints (positions are irrelevant to box sizing).
  const { rects } = computeLayout(resources, { isContainer });
  const byId = new Map(resources.map((r) => [r.id, r]));

  // Resolve a node to its top-level root (walk parentId, guarding cycles).
  const rootCache = new Map<string, string>();
  const rootOf = (id: string): string => {
    const cached = rootCache.get(id);
    if (cached) return cached;
    const seen = new Set<string>();
    let cur = id;
    for (;;) {
      const pid = byId.get(cur)?.parentId;
      if (!pid || pid === cur || !byId.has(pid) || seen.has(pid)) break;
      seen.add(cur);
      cur = pid;
    }
    rootCache.set(id, cur);
    return cur;
  };

  const rootIds = resources.filter((r) => rootOf(r.id) === r.id).map((r) => r.id);
  const rootSet = new Set(rootIds);
  const size = (id: string) => {
    const b = rects.get(id);
    return { w: b?.w ?? DEFAULT_LEAF_W, h: b?.h ?? DEFAULT_LEAF_H };
  };

  // Root-level adjacency (dedup, self-loops dropped), with indegree.
  const adj = new Map<string, Set<string>>(rootIds.map((id) => [id, new Set<string>()]));
  const indeg = new Map<string, number>(rootIds.map((id) => [id, 0]));
  for (const e of relationships) {
    const u = rootOf(e.from);
    const v = rootOf(e.to);
    if (!rootSet.has(u) || !rootSet.has(v) || u === v) continue;
    if (!adj.get(u)!.has(v)) {
      adj.get(u)!.add(v);
      indeg.set(v, (indeg.get(v) ?? 0) + 1);
    }
  }

  // Connected = participates in at least one root-level edge.
  const connectedSet = new Set<string>();
  for (const [u, vs] of adj) {
    if (vs.size) connectedSet.add(u);
    for (const v of vs) connectedSet.add(v);
  }
  const connected = rootIds.filter((id) => connectedSet.has(id));
  const isolated = rootIds.filter((id) => !connectedSet.has(id));

  // Longest-path layering via Kahn (cycle-safe: back-edges in a cycle just don't
  // push their target further, and any unreached node falls back to tier 0).
  const tier = new Map<string, number>();
  const localIndeg = new Map(connected.map((id) => [id, indeg.get(id) ?? 0]));
  const queue = connected.filter((id) => (localIndeg.get(id) ?? 0) === 0);
  for (const id of queue) tier.set(id, 0);
  for (let head = 0; head < queue.length; head++) {
    const u = queue[head];
    const tu = tier.get(u) ?? 0;
    for (const v of adj.get(u) ?? []) {
      tier.set(v, Math.max(tier.get(v) ?? 0, tu + 1));
      localIndeg.set(v, (localIndeg.get(v) ?? 0) - 1);
      if ((localIndeg.get(v) ?? 0) === 0) queue.push(v);
    }
  }
  for (const id of connected) if (!tier.has(id)) tier.set(id, 0);

  // Bucket by tier; order within a tier by the node's original position so a
  // user's rough vertical intent is preserved and the result is deterministic.
  const tiers = new Map<number, string[]>();
  for (const id of connected) {
    const t = tier.get(id) ?? 0;
    const arr = tiers.get(t);
    if (arr) arr.push(id);
    else tiers.set(t, [id]);
  }
  const pos = (id: string) => byId.get(id)?.position ?? { x: 0, y: 0 };
  for (const arr of tiers.values()) {
    arr.sort((a, b) => pos(a).y - pos(b).y || pos(a).x - pos(b).x || (a < b ? -1 : 1));
  }

  const out: ArrangedPosition[] = [];
  let x = originX;
  let maxBottom = originY;
  for (const t of [...tiers.keys()].sort((a, b) => a - b)) {
    const col = tiers.get(t)!;
    const colW = col.reduce((m, id) => Math.max(m, size(id).w), 0);
    let y = originY;
    for (const id of col) {
      out.push({ id, x: snap(x), y: snap(y) });
      y += size(id).h + gapY;
    }
    maxBottom = Math.max(maxBottom, y);
    x += colW + gapX;
  }

  // Disconnected roots: a tidy grid below the layered block.
  if (isolated.length) {
    const items = isolated.map((id) => ({ id, ...size(id) }));
    const startY = out.length ? snap(maxBottom + gapY) : originY;
    for (const p of gridPack(items, { originX, originY: startY, gap: gapY })) {
      out.push({ id: p.id, x: snap(p.x), y: snap(p.y) });
    }
  }

  return out;
}
