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
import type { RelationshipKind, CloudProvider } from "./types";
import { getService } from "./registry";

/**
 * A cloud account/project/subscription in scope for a diagram/environment.
 * `accountId` is provider-shaped: an AWS 12-digit account id, a GCP project id,
 * or an Azure subscription GUID.
 */
export interface Account {
  id: string;
  /** Cloud provider (defaults to AWS for back-compat). */
  provider?: CloudProvider;
  /** AWS 12-digit account id | GCP project-id | Azure subscription GUID. */
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

  /**
   * Verbatim provider-native source captured at import, for faithful re-emit.
   * The renderer/inspector never read this — it exists purely so IaC export can
   * reconstruct the original resource (with real property names and intrinsic
   * functions intact) instead of a lossy scaffold. Absent for manually-created
   * resources. Contains template data only — never credentials.
   */
  raw?: RawSource;

  // ---- presentation ----
  position?: CanvasPosition;
}

/** Lossless carrier of a resource's original IaC source (see `ResourceInstance.raw`). */
export interface RawSource {
  /** Source IaC format the `type`/`properties` belong to. */
  format: "cloudformation" | "arm" | "terraform";
  /** Original resource type, exact — preserves variant identity. */
  type: string;
  /** Original properties, with intrinsic functions (Ref/GetAtt/…) intact. */
  properties?: Record<string, unknown>;
  /** Explicit dependency logical ids (CloudFormation `DependsOn`, ARM `dependsOn`). */
  dependsOn?: string[];
  /** CloudFormation `Condition` gating this resource, if any. */
  condition?: string;
  /** Resource-level metadata block. */
  metadata?: Record<string, unknown>;
  /** ARM `apiVersion` (Azure only). */
  apiVersion?: string;
}

/** A typed, directional (or symmetric) edge between two resources. */
export interface Relationship {
  id: string;
  from: string; // ResourceInstance.id
  to: string; // ResourceInstance.id
  kind: RelationshipKind;
  /** Optional human label / rule detail (e.g. "tcp 443"). */
  label?: string;
  /**
   * For `routes_to` edges: the route's destination CIDR (e.g. "0.0.0.0/0").
   * Lets validation distinguish a default route (general egress) from a
   * prefix-specific one. Absent means "unspecified" — treated as a default
   * route for back-compat with manually-drawn edges that omit it.
   */
  destinationCidr?: string;
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
  /**
   * Presentation-only annotation layer (notes / callouts / zones). Excluded
   * from validation, cost and IaC emit. See src/aws/annotations.ts.
   */
  annotations?: import("./annotations").Annotation[];
  /**
   * Round-trip carrier for IaC template sections Strata doesn't model as graph
   * nodes (CloudFormation/ARM Parameters, Outputs, Mappings, Conditions, …).
   * Captured on import so export can re-emit a faithful template. Template data
   * only — never credentials.
   */
  iacSource?: IacSource;
  /** ISO timestamps; stamped by the server/repository, never inside scripts. */
  createdAt?: string;
  updatedAt?: string;
  /** Schema version for forward migration. */
  schemaVersion: number;
}

/** Template-level sections preserved for faithful IaC re-emit (see `InfrastructureGraph.iacSource`). */
export interface IacSource {
  format: "cloudformation" | "arm";
  formatVersion?: string;
  description?: string;
  parameters?: Record<string, unknown>;
  mappings?: Record<string, unknown>;
  conditions?: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  transform?: unknown;
  /** ARM template `$schema`/`contentVersion` (Azure only). */
  armSchema?: string;
  contentVersion?: string;
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

/** True for a value that has the minimum `ResourceInstance` shape we rely on. */
function isResourceLike(value: unknown): value is ResourceInstance {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as ResourceInstance).id === "string" &&
    typeof (value as ResourceInstance).serviceId === "string"
  );
}

/** True for a value that has the minimum `Relationship` shape we rely on. */
function isRelationshipLike(value: unknown): value is Relationship {
  const e = value as Relationship;
  return (
    typeof value === "object" &&
    value !== null &&
    typeof e.id === "string" &&
    typeof e.from === "string" &&
    typeof e.to === "string"
  );
}

/**
 * Basic structural integrity check (dangling refs, duplicate ids, unknown
 * services, self-edges). Also rejects array elements that aren't well-formed
 * objects — untrusted bodies/files can smuggle primitives (e.g.
 * `resources: [42]`) past the array-only shape check in `isInfrastructureGraph`,
 * and persisting those silently corrupts the store and crashes downstream
 * readers of `r.serviceId` / `r.config`.
 */
export function validateGraph(g: InfrastructureGraph): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  g.resources.forEach((r, i) => {
    if (!isResourceLike(r)) {
      errors.push(`Resource entry #${i} is not a valid resource object`);
      return;
    }
    if (ids.has(r.id)) errors.push(`Duplicate resource id ${r.id}`);
    ids.add(r.id);
    // The model↔registry boundary: a stale/typo'd serviceId passes every shape
    // check but has no icon/config schema, so flag it here rather than letting
    // it fail later in the renderer.
    if (!getService(r.serviceId)) {
      errors.push(`Resource ${r.id} references unknown service ${r.serviceId}`);
    }
    // Only validate parentId when one is set; a resource with no parent is a
    // valid top-level node, so the `r.parentId &&` short-circuit skips it.
    if (r.parentId && !g.resources.some((x) => isResourceLike(x) && x.id === r.parentId)) {
      errors.push(`Resource ${r.id} references missing parent ${r.parentId}`);
    }
  });
  const relIds = new Set<string>();
  g.relationships.forEach((e, i) => {
    if (!isRelationshipLike(e)) {
      errors.push(`Relationship entry #${i} is not a valid relationship object`);
      return;
    }
    if (relIds.has(e.id)) errors.push(`Duplicate relationship id ${e.id}`);
    relIds.add(e.id);
    if (e.from === e.to) errors.push(`Relationship ${e.id} connects ${e.from} to itself`);
    if (!ids.has(e.from)) errors.push(`Relationship ${e.id} references missing from ${e.from}`);
    if (!ids.has(e.to)) errors.push(`Relationship ${e.id} references missing to ${e.to}`);
    if (!isRelationshipKind(e.kind))
      errors.push(`Relationship ${e.id} has invalid kind ${String(e.kind)}`);
  });
  return errors;
}
