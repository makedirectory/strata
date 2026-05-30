/**
 * Strata — Domain Data Model
 * ------------------------------------
 * The persisted representation of an AWS environment. Deliberately decoupled
 * from the canvas/rendering layer: a `ResourceInstance` references a
 * `ServiceDefinition` by id and carries config keyed by that service's
 * ConfigField keys, plus placement (account/region/vpc/subnet) and an optional
 * canvas position. This is what the server stores and what the MCP importer
 * produces.
 */
import type { RelationshipKind } from "./types";

/** An AWS account in scope for a diagram/environment. */
export interface Account {
  id: string;
  /** 12-digit AWS account id. */
  accountId: string;
  name: string;
  /** e.g. "prod", "staging", "sandbox". */
  environment?: string;
  color?: string;
}

/** A region reference (code + human label). */
export interface RegionRef {
  code: string; // e.g. "us-east-1"
  name: string; // e.g. "US East (N. Virginia)"
}

/** Where a resource came from — drives trust/edit affordances. */
export type ResourceSource = "manual" | "imported" | "mcp";

/** Canvas placement (kept separate from logical data). */
export interface CanvasPosition {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A concrete instance of an AWS service within an environment. */
export interface ResourceInstance {
  id: string;
  /** References ServiceDefinition.id in the registry. */
  serviceId: string;
  name: string;

  // ---- placement / scoping ----
  accountId?: string;
  region?: string;
  /** Logical containment parent (VPC contains subnet, subnet contains EC2…). */
  parentId?: string;

  // ---- data ----
  /** Config keyed by the service's ConfigField keys. */
  config: Record<string, unknown>;
  /** AWS resource tags. */
  tags?: Record<string, string>;
  /** Real ARN when known (imported/MCP resources). */
  arn?: string;
  source: ResourceSource;

  // ---- presentation ----
  position?: CanvasPosition;
}

/** A typed, directional (or symmetric) edge between two resources. */
export interface Relationship {
  id: string;
  from: string; // ResourceInstance.id
  to: string; // ResourceInstance.id
  kind: RelationshipKind;
  /** Optional human label / rule detail (e.g. "tcp 443"). */
  label?: string;
  source?: ResourceSource;
}

/** Canvas viewport state persisted with a graph. */
export interface Viewport {
  x: number;
  y: number;
  scale: number;
}

/** Top-level persisted entity: an environment / architecture diagram. */
export interface InfrastructureGraph {
  id: string;
  name: string;
  description?: string;
  accounts: Account[];
  resources: ResourceInstance[];
  relationships: Relationship[];
  viewport?: Viewport;
  /** ISO timestamps; stamped by the server/repository, never inside scripts. */
  createdAt?: string;
  updatedAt?: string;
  /** Schema version for forward migration. */
  schemaVersion: number;
}

export const SCHEMA_VERSION = 1;

/**
 * Runtime list of every valid `RelationshipKind`. `RelationshipKind` is a
 * compile-time union, so a runtime guard (e.g. `validateGraph`) needs an
 * explicit value set to check request data against. Kept in lockstep with the
 * union in `./types`; the `satisfies` clause makes a drift a compile error.
 */
export const RELATIONSHIP_KINDS = [
  "contains",
  "attached_to",
  "routes_to",
  "depends_on",
  "allows",
  "targets",
  "reads_from",
  "writes_to",
  "invokes",
  "publishes_to",
  "subscribes_to",
  "assumes",
  "grants",
  "monitors",
  "peers_with",
  "connects_to",
] as const satisfies readonly RelationshipKind[];

// Exhaustiveness guard (type-only, no runtime effect): if a new
// RelationshipKind is added to the union in `./types` but not to
// RELATIONSHIP_KINDS above, `MissingKinds` becomes a non-`never` type and this
// assignment fails to compile.
type MissingKinds = Exclude<RelationshipKind, (typeof RELATIONSHIP_KINDS)[number]>;
type _AssertNoMissingKinds = MissingKinds extends never ? true : never;
const _assertAllKindsCovered: _AssertNoMissingKinds = true;
void _assertAllKindsCovered;

const RELATIONSHIP_KIND_SET: ReadonlySet<string> = new Set(RELATIONSHIP_KINDS);

/** True when `kind` is one of the known `RelationshipKind` values. */
export function isRelationshipKind(kind: unknown): kind is RelationshipKind {
  return typeof kind === "string" && RELATIONSHIP_KIND_SET.has(kind);
}

/**
 * Default canvas size for a freshly placed resource node. Centralised so the
 * store, renderer fallback and MCP grid layout stay in sync. Wide enough to fit
 * common service names (e.g. "CloudFormation") without truncation.
 */
export const DEFAULT_NODE_SIZE = { w: 240, h: 100 } as const;

/** A minimal, valid empty graph. `id`/timestamps are assigned on persist. */
export function emptyGraph(name = "Untitled Architecture"): InfrastructureGraph {
  return {
    id: "",
    name,
    accounts: [],
    resources: [],
    relationships: [],
    viewport: { x: 200, y: 120, scale: 1 },
    schemaVersion: SCHEMA_VERSION,
  };
}

/** Lightweight summary used by list endpoints (avoids shipping full graphs). */
export interface GraphSummary {
  id: string;
  name: string;
  description?: string;
  resourceCount: number;
  updatedAt?: string;
}

export function summarize(g: InfrastructureGraph): GraphSummary {
  return {
    id: g.id,
    name: g.name,
    description: g.description,
    resourceCount: g.resources.length,
    updatedAt: g.updatedAt,
  };
}

// ----- Graph helpers --------------------------------------------------------

// These return freshly-filtered, readonly views. The arrays are new (safe to
// hold), but the element objects are shared with the graph — treat both as
// read-only and never mutate them in place.

export function resourcesByAccount(
  g: InfrastructureGraph,
  accountId: string,
): readonly ResourceInstance[] {
  return g.resources.filter((r) => r.accountId === accountId);
}

export function childrenOf(g: InfrastructureGraph, parentId: string): readonly ResourceInstance[] {
  return g.resources.filter((r) => r.parentId === parentId);
}

export function relationshipsOf(
  g: InfrastructureGraph,
  resourceId: string,
): readonly Relationship[] {
  return g.relationships.filter((e) => e.from === resourceId || e.to === resourceId);
}

/** Basic structural integrity check (dangling refs, duplicate ids). */
export function validateGraph(g: InfrastructureGraph): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const r of g.resources) {
    if (ids.has(r.id)) errors.push(`Duplicate resource id ${r.id}`);
    ids.add(r.id);
    // Only validate parentId when one is set; a resource with no parent is a
    // valid top-level node, so the `r.parentId &&` short-circuit skips it.
    if (r.parentId && !g.resources.some((x) => x.id === r.parentId)) {
      errors.push(`Resource ${r.id} references missing parent ${r.parentId}`);
    }
  }
  for (const e of g.relationships) {
    if (!ids.has(e.from)) errors.push(`Relationship ${e.id} references missing from ${e.from}`);
    if (!ids.has(e.to)) errors.push(`Relationship ${e.id} references missing to ${e.to}`);
    if (!isRelationshipKind(e.kind))
      errors.push(`Relationship ${e.id} has invalid kind ${String(e.kind)}`);
  }
  return errors;
}
