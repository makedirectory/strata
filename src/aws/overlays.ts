/**
 * Analytical overlays (Phase 6) — pure, framework-free.
 *
 * Each overlay derives a *highlight set* (lit node + edge ids) or a per-node
 * *heat value* from the existing relationship graph; the canvas renders them
 * through the same dim/tint machinery used by focus and layers.
 *
 * Scope note: these are TOPOLOGY-based, computed only from modelled
 * relationships — they do not evaluate security-group rules, IAM policy
 * documents, or real pricing (the model doesn't carry that). IAM-trust traces
 * the permission-relationship neighbourhood; "security path" traces the
 * network-relationship neighbourhood; heat is a degree proxy for cost/usage.
 */
import type { ResourceInstance, Relationship } from "./model";
import { relationshipClassOf, type RelationshipClass } from "./relationshipClasses";

export type OverlayKind = "none" | "iam" | "security" | "heat";

/** Emphasised node + relationship ids for an overlay. */
export interface OverlayLit {
  nodes: Set<string>;
  edges: Set<string>;
}

/**
 * Lit set over the relationships of a given class. With a `focusId` it is the
 * connected neighbourhood reachable from that node (undirected BFS); otherwise
 * the whole class subgraph.
 */
function litOverClass(
  resources: readonly ResourceInstance[],
  relationships: readonly Relationship[],
  cls: RelationshipClass,
  focusId?: string | null,
): OverlayLit {
  const edges = relationships.filter((r) => relationshipClassOf(r.kind) === cls);
  const nodes = new Set<string>();
  const edgeIds = new Set<string>();

  const hasFocus = !!focusId && resources.some((r) => r.id === focusId);
  if (!hasFocus) {
    for (const e of edges) {
      nodes.add(e.from);
      nodes.add(e.to);
      edgeIds.add(e.id);
    }
    return { nodes, edges: edgeIds };
  }

  // Undirected adjacency over the class edges.
  const adj = new Map<string, Array<{ other: string; id: string }>>();
  const push = (a: string, other: string, id: string) => {
    const list = adj.get(a);
    if (list) list.push({ other, id });
    else adj.set(a, [{ other, id }]);
  };
  for (const e of edges) {
    push(e.from, e.to, e.id);
    push(e.to, e.from, e.id);
  }

  nodes.add(focusId!);
  const queue = [focusId!];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const { other, id } of adj.get(cur) ?? []) {
      edgeIds.add(id);
      if (!nodes.has(other)) {
        nodes.add(other);
        queue.push(other);
      }
    }
  }
  return { nodes, edges: edgeIds };
}

/** IAM-trust neighbourhood: assume/grant/allow (permission class) reachability. */
export function iamTrustOverlay(
  resources: readonly ResourceInstance[],
  relationships: readonly Relationship[],
  focusId?: string | null,
): OverlayLit {
  return litOverClass(resources, relationships, "permission", focusId);
}

/** Network-path neighbourhood: routes/connects/attaches/peers (network class). */
export function securityPathOverlay(
  resources: readonly ResourceInstance[],
  relationships: readonly Relationship[],
  focusId?: string | null,
): OverlayLit {
  return litOverClass(resources, relationships, "network", focusId);
}

/**
 * Per-node heat in [0,1] by relationship degree (a connectivity proxy for
 * cost/usage). Normalised to the busiest node; everything is 0 when there are
 * no relationships.
 */
export function heatByDegree(
  resources: readonly ResourceInstance[],
  relationships: readonly Relationship[],
): Map<string, number> {
  const degree = new Map<string, number>();
  for (const r of resources) degree.set(r.id, 0);
  for (const e of relationships) {
    if (degree.has(e.from)) degree.set(e.from, degree.get(e.from)! + 1);
    if (degree.has(e.to)) degree.set(e.to, degree.get(e.to)! + 1);
  }
  let max = 0;
  for (const d of degree.values()) max = Math.max(max, d);
  const heat = new Map<string, number>();
  for (const [id, d] of degree) heat.set(id, max === 0 ? 0 : d / max);
  return heat;
}

/** Map a heat ratio [0,1] to a blue→amber→red colour. */
export function heatColor(t: number): string {
  const clamped = Math.max(0, Math.min(1, t));
  if (clamped < 0.5) {
    // blue → amber
    return mix("#3b82f6", "#fbbf24", clamped / 0.5);
  }
  // amber → red
  return mix("#fbbf24", "#ef4444", (clamped - 0.5) / 0.5);
}

function mix(a: string, b: string, t: number): string {
  const pa = hexToRgb(a);
  const pb = hexToRgb(b);
  const r = Math.round(pa[0] + (pb[0] - pa[0]) * t);
  const g = Math.round(pa[1] + (pb[1] - pa[1]) * t);
  const bl = Math.round(pa[2] + (pb[2] - pa[2]) * t);
  return `rgb(${r}, ${g}, ${bl})`;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
