/**
 * Containment layout engine — pure, framework-free.
 *
 * Phase 2 makes `ResourceInstance.parentId` a *visual* hierarchy: containers
 * (VPC ▸ subnet ▸ resource, account ▸ region, ECS/EKS cluster, …) auto-fit and
 * pack their children. The user arranges only top-level nodes; every child's
 * position is OWNED by this layout. `computeLayout` turns the resource list +
 * the collapsed set (+ an optional live-drag override) into an effective world
 * rect for every visible node, which the renderer, edges and hit-testing read
 * instead of the stored model position.
 *
 * Pure: no React/DOM, no registry import (container-ness is supplied as a
 * predicate so this stays trivially testable).
 */
import type { ResourceInstance } from "../aws/model";
import type { CanvasDensity } from "../types";
import type { Rect } from "./geometry";

// ---- tunables (world units) ----
export const HEADER_H = 40;
export const PAD = 16;
export const GAP = 16;
export const COLLAPSED_W = 220;
export const COLLAPSED_H = HEADER_H;
/** Fallback leaf size when a resource has no stored geometry. */
export const DEFAULT_LEAF_W = 240;
export const DEFAULT_LEAF_H = 100;
/** Trimmed leaf height in Compact density. */
export const COMPACT_LEAF_H = 64;
/** Minimum content box for a container with no (visible) children. */
export const EMPTY_CONTENT_W = 200;
export const EMPTY_CONTENT_H = 48;

export interface LayoutOptions {
  /** Container ids whose children are hidden. */
  collapsed?: ReadonlySet<string>;
  /** True for resources that visually contain others (registry `isContainer`). */
  isContainer: (r: ResourceInstance) => boolean;
  density?: CanvasDensity;
  /**
   * Live drag override: this node (and its subtree) is treated as a detached
   * root anchored at (x,y) — its former parent repacks without it — so a drag
   * reads naturally and reparents on drop.
   */
  override?: { id: string; x: number; y: number } | null;
  /**
   * Leaf summarization: collapse ≥`threshold` same-type leaf children of a
   * container into one summary node, unless its `${parentId}::${serviceId}` key
   * is in `expandedGroups`. Omit to disable.
   */
  summarize?: { threshold: number; expandedGroups: ReadonlySet<string> };
}

/** A synthetic node standing in for N summarized same-type leaves. */
export interface SummaryNode {
  /** Synthetic rect id, `summary::${parentId}::${serviceId}`. */
  id: string;
  parentId: string;
  serviceId: string;
  count: number;
  memberIds: string[];
}

/** Group key for an expandable summary. */
export function summaryKey(parentId: string, serviceId: string): string {
  return `${parentId}::${serviceId}`;
}
export function summaryId(parentId: string, serviceId: string): string {
  return `summary::${summaryKey(parentId, serviceId)}`;
}

export interface LayoutResult {
  /** Effective world rect for every VISIBLE node (+ summary nodes). */
  rects: Map<string, Rect>;
  /** Nesting depth (0 = root) for z-stacking; visible nodes only. */
  depth: Map<string, number>;
  /** For a node hidden inside a collapsed/summarized container, its representative. */
  visibleAncestor: Map<string, string>;
  /** Whether a node is rendered as a container (registry flag or has children). */
  isContainerNode: (id: string) => boolean;
  /** Visible direct-child count for a container id (for the header badge). */
  childCount: (id: string) => number;
  /** Synthetic summary nodes the renderer must draw (keyed in `rects`). */
  summaries: SummaryNode[];
}

/** A sized subtree with children placed relative to the parent's content origin. */
interface Box {
  id: string;
  w: number;
  h: number;
  container: boolean;
  children: Array<Box & { relX: number; relY: number }>;
}

function leafSize(
  r: ResourceInstance | undefined,
  density: CanvasDensity,
): { w: number; h: number } {
  const w = r?.position?.w ?? DEFAULT_LEAF_W;
  const baseH = r?.position?.h ?? DEFAULT_LEAF_H;
  return { w, h: density === "compact" ? COMPACT_LEAF_H : baseH };
}

export function computeLayout(
  resources: readonly ResourceInstance[],
  opts: LayoutOptions,
): LayoutResult {
  const {
    collapsed = new Set<string>(),
    isContainer,
    density = "comfortable",
    override = null,
    summarize,
  } = opts;

  const summaries: SummaryNode[] = [];

  const byId = new Map<string, ResourceInstance>();
  for (const r of resources) byId.set(r.id, r);

  // Direct children per parent (in resource order). A parentId that is missing
  // or self-referential is ignored (the node is treated as a root).
  const childrenByParent = new Map<string, ResourceInstance[]>();
  for (const r of resources) {
    const pid = r.parentId;
    if (pid && pid !== r.id && byId.has(pid)) {
      const list = childrenByParent.get(pid);
      if (list) list.push(r);
      else childrenByParent.set(pid, [r]);
    }
  }
  const kidsOf = (id: string) => childrenByParent.get(id) ?? [];
  const isContainerNode = (id: string) => {
    const r = byId.get(id);
    return r ? isContainer(r) || kidsOf(id).length > 0 : false;
  };

  // Valid (acyclic) parent of a node, or undefined if it should be a root.
  const parentOf = (id: string): string | undefined => {
    const r = byId.get(id);
    let pid = r?.parentId;
    if (!pid || pid === id || !byId.has(pid)) return undefined;
    // Walk up to detect a cycle; if found, treat this node as a root.
    const seen = new Set<string>([id]);
    let cur: string | undefined = pid;
    while (cur) {
      if (seen.has(cur)) return undefined;
      seen.add(cur);
      cur = byId.get(cur)?.parentId;
      if (cur && !byId.has(cur)) break;
    }
    return pid;
  };

  // Nodes hidden because some ancestor is collapsed, and the outermost collapsed
  // ancestor that represents them on-canvas.
  const hidden = new Set<string>();
  const visibleAncestor = new Map<string, string>();
  for (const r of resources) {
    let rep: string | undefined;
    let cur = parentOf(r.id);
    const guard = new Set<string>();
    while (cur && !guard.has(cur)) {
      guard.add(cur);
      if (collapsed.has(cur)) rep = cur; // outermost wins (last assignment up the chain)
      cur = parentOf(cur);
    }
    if (rep) {
      hidden.add(r.id);
      visibleAncestor.set(r.id, rep);
    }
  }

  const cols = (n: number) => Math.max(1, Math.ceil(Math.sqrt(n)));

  // Post-order: size a node and place its children relative to its content box.
  const build = (id: string, onPath: Set<string>): Box => {
    const r = byId.get(id);
    const container = isContainerNode(id);
    if (collapsed.has(id)) {
      return { id, w: COLLAPSED_W, h: COLLAPSED_H, container, children: [] };
    }
    // Exclude the dragged node so its former parent repacks without it.
    const kids = kidsOf(id).filter((k) => !onPath.has(k.id) && k.id !== override?.id);
    if (!container || kids.length === 0) {
      if (container) {
        // Empty (or childless) container: header + a small drop area.
        return {
          id,
          w: EMPTY_CONTENT_W + PAD * 2,
          h: HEADER_H + PAD + EMPTY_CONTENT_H + PAD,
          container: true,
          children: [],
        };
      }
      const s = leafSize(r, density);
      return { id, w: s.w, h: s.h, container: false, children: [] };
    }

    const nextPath = new Set(onPath);
    nextPath.add(id);

    // Leaf summarization: group same-type leaf children; a group of ≥threshold
    // that isn't expanded becomes one summary box (its members are hidden and
    // represented by the summary). Containers/expanded groups render normally.
    const shown: ResourceInstance[] = [];
    const summaryBoxes: Box[] = [];
    if (summarize) {
      const leafGroups = new Map<string, ResourceInstance[]>();
      for (const k of kids) {
        if (isContainerNode(k.id)) {
          shown.push(k);
        } else {
          const g = leafGroups.get(k.serviceId);
          if (g) g.push(k);
          else leafGroups.set(k.serviceId, [k]);
        }
      }
      for (const [serviceId, members] of leafGroups) {
        const key = summaryKey(id, serviceId);
        if (members.length >= summarize.threshold && !summarize.expandedGroups.has(key)) {
          const sid = summaryId(id, serviceId);
          summaries.push({
            id: sid,
            parentId: id,
            serviceId,
            count: members.length,
            memberIds: members.map((m) => m.id),
          });
          for (const m of members) {
            hidden.add(m.id);
            visibleAncestor.set(m.id, sid);
          }
          const s = leafSize(members[0], density);
          summaryBoxes.push({ id: sid, w: s.w, h: s.h, container: false, children: [] });
        } else {
          shown.push(...members);
        }
      }
    } else {
      shown.push(...kids);
    }

    const childBoxes = [...shown.map((k) => build(k.id, nextPath)), ...summaryBoxes];

    // Flow-pack into rows of `c` columns; rows left-aligned with GAP spacing.
    const c = cols(childBoxes.length);
    const placed: Array<Box & { relX: number; relY: number }> = [];
    let x = 0;
    let y = 0;
    let rowH = 0;
    let contentW = 0;
    childBoxes.forEach((b, i) => {
      if (i > 0 && i % c === 0) {
        y += rowH + GAP;
        x = 0;
        rowH = 0;
      }
      placed.push({ ...b, relX: x, relY: y });
      x += b.w + GAP;
      contentW = Math.max(contentW, x - GAP);
      rowH = Math.max(rowH, b.h);
    });
    const contentH = y + rowH;
    return {
      id,
      w: Math.max(EMPTY_CONTENT_W, contentW) + PAD * 2,
      h: HEADER_H + PAD + contentH + PAD,
      container: true,
      children: placed,
    };
  };

  const rects = new Map<string, Rect>();
  const depth = new Map<string, number>();

  const place = (box: Box, x: number, y: number, d: number) => {
    rects.set(box.id, { x, y, w: box.w, h: box.h });
    depth.set(box.id, d);
    const contentX = x + PAD;
    const contentY = y + HEADER_H + PAD;
    for (const child of box.children) {
      place(child, contentX + child.relX, contentY + child.relY, d + 1);
    }
  };

  // Roots: nodes with no valid parent, plus the drag-override node (detached).
  const overrideId = override?.id;
  const placeRoot = (id: string, x: number, y: number) => {
    if (rects.has(id)) return;
    place(build(id, new Set<string>()), x, y, 0);
  };

  for (const r of resources) {
    if (hidden.has(r.id)) continue;
    if (r.id === overrideId) continue; // placed last, at the cursor
    if (parentOf(r.id) === undefined) {
      const p = r.position ?? { x: 0, y: 0 };
      placeRoot(r.id, p.x, p.y);
    }
  }

  // Orphans (e.g. broken by a cycle) that were never placed: anchor at stored pos.
  for (const r of resources) {
    if (hidden.has(r.id) || rects.has(r.id) || r.id === overrideId) continue;
    const p = r.position ?? { x: 0, y: 0 };
    placeRoot(r.id, p.x, p.y);
  }

  // The dragged subtree, anchored at the override point and on top.
  if (override && byId.has(override.id) && !hidden.has(override.id)) {
    place(build(override.id, new Set<string>()), override.x, override.y, 0);
  }

  // Direct children that are still rendered (real child placed, or summarized
  // into a summary box) — for the container header badge.
  const summarizedParents = new Set(summaries.map((s) => s.parentId));
  const childCount = (id: string) => {
    if (!summarizedParents.has(id)) return kidsOf(id).filter((k) => rects.has(k.id)).length;
    // Count visible real children + members hidden behind this container's summaries.
    const direct = kidsOf(id).filter((k) => rects.has(k.id)).length;
    const summarizedMembers = summaries
      .filter((s) => s.parentId === id)
      .reduce((n, s) => n + s.count, 0);
    return direct + summarizedMembers;
  };

  return { rects, depth, visibleAncestor, isContainerNode, childCount, summaries };
}
