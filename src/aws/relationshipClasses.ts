/**
 * Relationship classes — the visual encoding axis for edges (Phase 3).
 *
 * Every `RelationshipKind` belongs to one class; a class owns a colour + dash
 * pattern + arrowhead so `depends_on`, `routes_to`, `allows`, data flow, etc.
 * are legibly different, and each class can be toggled as a layer. Containment
 * is modelled as nesting (Phase 2), not an edge, but the class is kept for any
 * legacy `contains` edges.
 */
import type { RelationshipKind } from "./types";

export type RelationshipClass =
  | "network"
  | "data"
  | "dependency"
  | "permission"
  | "observability"
  | "containment";

export interface RelationshipClassDef {
  id: RelationshipClass;
  label: string;
  /** Stroke colour for edges of this class. */
  color: string;
  /** SVG `stroke-dasharray`, or null for a solid line. */
  dash: string | null;
}

export const RELATIONSHIP_CLASSES: Readonly<Record<RelationshipClass, RelationshipClassDef>> = {
  network: { id: "network", label: "Network", color: "#60a5fa", dash: null },
  data: { id: "data", label: "Data flow", color: "#34d399", dash: null },
  dependency: { id: "dependency", label: "Dependency", color: "#a78bfa", dash: "6 4" },
  permission: { id: "permission", label: "Permission", color: "#fbbf24", dash: "2 4" },
  observability: { id: "observability", label: "Observability", color: "#22d3ee", dash: "4 4" },
  containment: { id: "containment", label: "Containment", color: "#94a3b8", dash: "1 5" },
};

/** Stable order for the legend / layer panel. */
export const RELATIONSHIP_CLASS_ORDER: readonly RelationshipClass[] = [
  "network",
  "data",
  "dependency",
  "permission",
  "observability",
  "containment",
];

/**
 * Map each relationship kind to its class. `satisfies` makes adding a new
 * `RelationshipKind` without classifying it a compile error.
 */
const KIND_TO_CLASS = {
  routes_to: "network",
  peers_with: "network",
  connects_to: "network",
  attached_to: "network",
  reads_from: "data",
  writes_to: "data",
  publishes_to: "data",
  subscribes_to: "data",
  targets: "data",
  depends_on: "dependency",
  invokes: "dependency",
  allows: "permission",
  assumes: "permission",
  grants: "permission",
  monitors: "observability",
  contains: "containment",
} satisfies Record<RelationshipKind, RelationshipClass>;

export function relationshipClassOf(kind: RelationshipKind): RelationshipClass {
  return KIND_TO_CLASS[kind];
}

export function relationshipClassDef(kind: RelationshipKind): RelationshipClassDef {
  return RELATIONSHIP_CLASSES[relationshipClassOf(kind)];
}
