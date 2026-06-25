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
import { emptyGraph } from "./model";
import { litReachable } from "./reachability";
import { relationshipClassOf } from "./relationshipClasses";
import type { RelationshipKind } from "./types";
import type { ChangeKind } from "./planDiff";

export type OverlayKind = "none" | "iam" | "security" | "heat" | "reachability" | "tags" | "plan";

/** Emphasised node + relationship ids for an overlay. */
export interface OverlayLit {
  nodes: Set<string>;
  edges: Set<string>;
  /** Lit nodes that are internet-facing (network overlay only). */
  externalNodes?: Set<string>;
  /** Lit edges that cross the internet boundary (network overlay only). */
  externalEdges?: Set<string>;
}

/**
 * Relationship kinds that carry traffic, for the network-path overlay. This is
 * deliberately broader than the `network` *visual* class: `targets` (load
 * balancer → target group → compute) reads as data flow (its colour) but is
 * also a real network path, so the overlay traces it too.
 */
const NETWORK_PATH_KINDS = new Set<RelationshipKind>([
  "routes_to",
  "peers_with",
  "connects_to",
  "attached_to",
  "targets",
]);

/**
 * Service ids that sit on the internet boundary (the edge between a VPC and the
 * public internet). Used to split the network overlay into internal vs external
 * connections. `elastic-load-balancer` is conditional on its `scheme` config.
 */
const EXTERNAL_FACING_SERVICES = new Set([
  "internet-gateway",
  "nat-gateway",
  "cloudfront",
  "global-accelerator",
  "api-gateway",
]);

/** Whether a resource faces the public internet (so its edges are "external"). */
function isExternalFacing(r: ResourceInstance): boolean {
  if (EXTERNAL_FACING_SERVICES.has(r.serviceId)) return true;
  if (r.serviceId === "elastic-load-balancer") {
    return String(r.config?.scheme ?? "internet-facing") === "internet-facing";
  }
  return false;
}

/**
 * Lit set over the relationships matching `includeKind`. With a `focusId` it is
 * the connected neighbourhood reachable from that node (undirected BFS);
 * otherwise the whole matching subgraph.
 */
function litOverKinds(
  resources: readonly ResourceInstance[],
  relationships: readonly Relationship[],
  includeKind: (kind: RelationshipKind) => boolean,
  focusId?: string | null,
): OverlayLit {
  const edges = relationships.filter((r) => includeKind(r.kind));
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

/**
 * Lit set for a highlighting overlay kind, or `null` when there is nothing to
 * highlight. Returning `null` for an empty result is important: the renderer
 * dims everything *not* in the lit set, so an empty set would grey the entire
 * canvas — making the overlay look broken. `null` is a clean no-op (nothing
 * dimmed). `"none"` and `"heat"` are never highlighting overlays, so they are
 * `null` too (heat tints via a separate channel).
 */
export function overlayLitFor(
  kind: OverlayKind,
  resources: readonly ResourceInstance[],
  relationships: readonly Relationship[],
  focusId?: string | null,
): OverlayLit | null {
  let lit: OverlayLit | null = null;
  if (kind === "iam") lit = iamTrustOverlay(resources, relationships, focusId);
  else if (kind === "security") lit = securityPathOverlay(resources, relationships, focusId);
  else if (kind === "reachability") {
    // Decoupled engine lives in ./reachability; overlays.ts only delegates.
    const r = litReachable({
      ...emptyGraph(""),
      resources: [...resources],
      relationships: [...relationships],
    });
    lit = { nodes: r.nodes, edges: r.edges, externalNodes: r.externalNodes };
  }
  return lit && lit.nodes.size > 0 ? lit : null;
}

/** IAM-trust neighbourhood: assume/grant/allow (permission class) reachability. */
export function iamTrustOverlay(
  resources: readonly ResourceInstance[],
  relationships: readonly Relationship[],
  focusId?: string | null,
): OverlayLit {
  return litOverKinds(
    resources,
    relationships,
    (k) => relationshipClassOf(k) === "permission",
    focusId,
  );
}

/**
 * Network-path neighbourhood: traffic-bearing edges (routes/connects/attaches/
 * peers + load-balancer `targets`). Annotates which lit nodes/edges cross the
 * internet boundary so the canvas can distinguish intranet from external.
 */
export function securityPathOverlay(
  resources: readonly ResourceInstance[],
  relationships: readonly Relationship[],
  focusId?: string | null,
): OverlayLit {
  const lit = litOverKinds(resources, relationships, (k) => NETWORK_PATH_KINDS.has(k), focusId);
  const byId = new Map(resources.map((r) => [r.id, r]));
  const externalNodes = new Set<string>();
  for (const id of lit.nodes) {
    const r = byId.get(id);
    if (r && isExternalFacing(r)) externalNodes.add(id);
  }
  const externalEdges = new Set<string>();
  for (const e of relationships) {
    if (lit.edges.has(e.id) && (externalNodes.has(e.from) || externalNodes.has(e.to))) {
      externalEdges.add(e.id);
    }
  }
  lit.externalNodes = externalNodes;
  lit.externalEdges = externalEdges;
  return lit;
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

/**
 * Colour for a plan change kind (the "plan" overlay). Routed through the same
 * per-node tint channel the tag overlay uses, so the renderer needs no change.
 * `noop`/`read` return `null` (no tint — unchanged resources stay neutral).
 */
export function planChangeColor(kind: ChangeKind): string | null {
  switch (kind) {
    case "create":
      return "#16a34a"; // green
    case "update":
      return "#d97706"; // amber
    case "delete":
      return "#dc2626"; // red
    case "replace":
      return "#7c3aed"; // purple
    default:
      return null; // noop / read
  }
}

/** Per-node id → colour tint map for a plan diff (only changed nodes are tinted). */
export function planTintMap(changes: Record<string, ChangeKind>): Map<string, string> {
  const out = new Map<string, string>();
  for (const [id, kind] of Object.entries(changes)) {
    const color = planChangeColor(kind);
    if (color) out.set(id, color);
  }
  return out;
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
