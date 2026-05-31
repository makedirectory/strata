/**
 * Strata — MCP / Real-Infrastructure Discovery Readiness Layer
 * ----------------------------------------------------------------------
 * This module is the bridge between *real* AWS infrastructure and the in-app
 * `InfrastructureGraph` domain model. It is intentionally a pure, dependency-
 * free transform: it takes a flat list of `DiscoveredResource` objects and maps
 * them onto the registry-backed graph the canvas already knows how to render.
 *
 * Where the discovered resources come from
 * ----------------------------------------
 * The expected producer is the official AWS MCP server (Model Context Protocol)
 * and/or the AWS Cloud Control API (`cloudcontrol:ListResources` /
 * `GetResource`). Both speak in terms of **CloudFormation resource types**
 * (e.g. `"AWS::EC2::Instance"`, `"AWS::S3::Bucket"`). That CFN type string is
 * the *join key*: every `ServiceDefinition` in our registry carries a `cfnType`,
 * so `getServiceByCfnType(resourceType)` is all we need to resolve a discovered
 * resource to its visual/config metadata. Cloud Control also returns the same
 * `properties` shape CloudFormation uses, which lines up with our `configFields`.
 *
 * Typical flow once an MCP/Cloud-Control client is wired up:
 *   1. Caller authenticates to AWS *outside this module* (SSO, role, profile…).
 *   2. Caller enumerates resources per type/region and normalises each into a
 *      `DiscoveredResource` (arn, resourceType, properties, relationships…).
 *   3. `mapDiscoveredToGraph(resources)` produces a renderable graph.
 *   4. `unmappedTypes(resources)` reports CFN types we don't yet model so the
 *      registry can be extended (no UI changes required — see registry docs).
 *
 * Security invariant
 * ------------------
 * Credentials are NEVER stored in, derived into, or attached to the graph.
 * This layer only ever receives already-fetched resource descriptions. No
 * access keys, session tokens, secrets, or auth material are read or persisted
 * here. The only identifiers that land in the graph are non-sensitive AWS
 * metadata (ARNs, account ids, region codes, resource properties).
 */
import type { InfrastructureGraph, ResourceInstance, Relationship } from "./model";
import { emptyGraph, DEFAULT_NODE_SIZE } from "./model";
import type { RelationshipKind } from "./types";
import { RELATIONSHIPS } from "./categories";
import { getServiceByCfnType } from "./registry";

/**
 * A single resource as surfaced by an MCP server / Cloud Control API, after
 * light normalisation by the caller. `resourceType` (the CloudFormation type)
 * is the only strictly-required field for mapping.
 */
export interface DiscoveredResource {
  arn?: string;
  /** CloudFormation type, e.g. "AWS::EC2::Instance". The registry join key. */
  resourceType: string;
  logicalId?: string;
  name?: string;
  region?: string;
  accountId?: string;
  /** ARN of the logical containment parent (VPC for a subnet, etc.). */
  parentArn?: string;
  /** Raw CloudFormation/Cloud-Control properties for this resource. */
  properties?: Record<string, unknown>;
  /** Outgoing edges to other discovered resources, keyed by target ARN. */
  relationships?: { targetArn: string; kind?: string }[];
}

/**
 * The full set of valid relationship kinds, for runtime validation. Derived
 * from the single source of truth (`RELATIONSHIPS` in ./categories) rather than
 * a hand-maintained list, so it can never drift from the `RelationshipKind`
 * union: `RELATIONSHIPS` is typed `Record<RelationshipKind, …>`, so its keys
 * are exactly the union members.
 */
const RELATIONSHIP_KINDS: ReadonlySet<RelationshipKind> = new Set(
  Object.keys(RELATIONSHIPS) as RelationshipKind[],
);

function isRelationshipKind(v: string | undefined): v is RelationshipKind {
  // Runtime-checked narrowing: `RELATIONSHIP_KINDS` is derived from
  // `RELATIONSHIPS`, whose keys are exactly the `RelationshipKind` union, so
  // membership here implies the value is a valid kind.
  return v !== undefined && (RELATIONSHIP_KINDS as ReadonlySet<string>).has(v);
}

/**
 * Generate a UUID using the platform `crypto` (Web Crypto in browsers, the
 * global `crypto` in modern Node). Falls back to a sufficiently-random v4-ish
 * id when `randomUUID` is unavailable, so this module stays dependency-free and
 * works in both browser and SSR contexts.
 */
function generateId(): string {
  const c: Crypto | undefined = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = Math.floor(Math.random() * 16);
    const v = ch === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ----- Grid layout constants ------------------------------------------------

const NODE_W = DEFAULT_NODE_SIZE.w;
const NODE_H = DEFAULT_NODE_SIZE.h;
const COL_GAP = 80;
const ROW_GAP = 60;
const COLS = 5;
const ORIGIN_X = 80;
const ORIGIN_Y = 80;

/**
 * Map a list of discovered resources onto a renderable `InfrastructureGraph`.
 *
 * - Resolves `serviceId` via `getServiceByCfnType(resourceType)`; resources
 *   whose CFN type has no registry entry are skipped (see `unmappedTypes`).
 * - Each mapped resource becomes a `ResourceInstance` with `source: "mcp"`,
 *   an id of its ARN (or a generated UUID), config filtered to keys that match
 *   the service's `configFields`, and a `parentId` resolved from `parentArn`.
 * - Relationships are built from each resource's `relationships`, with `kind`
 *   defaulting to `"connects_to"` when missing or invalid.
 * - A simple grid auto-layout assigns positions so the graph renders without a
 *   layout engine.
 */
export function mapDiscoveredToGraph(
  resources: DiscoveredResource[],
  opts?: { name?: string },
): InfrastructureGraph {
  const graph = emptyGraph(opts?.name ?? "Discovered Infrastructure");

  // First pass: assign a stable graph id to every *mappable* resource and
  // build an arn -> id index so parents and relationships can be resolved.
  const arnToId = new Map<string, string>();
  const mappable: { res: DiscoveredResource; id: string; serviceId: string }[] = [];

  for (const res of resources) {
    const service = getServiceByCfnType(res.resourceType);
    if (!service) continue; // unmapped — skipped, reported by unmappedTypes()
    // De-duplicate by ARN: the resource id IS the ARN, so two resources sharing
    // an ARN would produce ResourceInstances with identical ids (which
    // validateGraph flags as duplicates). Keep the first, skip later ones.
    if (res.arn && arnToId.has(res.arn)) continue;
    const id = res.arn ?? generateId();
    if (res.arn) arnToId.set(res.arn, id);
    mappable.push({ res, id, serviceId: service.id });
  }

  // Second pass: build ResourceInstances with config, placement and layout.
  const instances: ResourceInstance[] = mappable.map(({ res, id, serviceId }, index) => {
    const service = getServiceByCfnType(res.resourceType)!;

    // Filter incoming properties down to the keys the service actually models.
    const config: Record<string, unknown> = {};
    if (res.properties) {
      for (const field of service.configFields) {
        if (Object.prototype.hasOwnProperty.call(res.properties, field.key)) {
          config[field.key] = res.properties[field.key];
        }
      }
    }

    const parentId = res.parentArn !== undefined ? arnToId.get(res.parentArn) : undefined;

    const col = index % COLS;
    const row = Math.floor(index / COLS);

    const instance: ResourceInstance = {
      id,
      serviceId,
      name: res.name ?? res.logicalId ?? service.name,
      source: "mcp",
      config,
      position: {
        x: ORIGIN_X + col * (NODE_W + COL_GAP),
        y: ORIGIN_Y + row * (NODE_H + ROW_GAP),
        w: NODE_W,
        h: NODE_H,
      },
    };
    if (res.region !== undefined) instance.region = res.region;
    if (res.accountId !== undefined) instance.accountId = res.accountId;
    // Skip a parent that resolves to the resource itself (a resource whose
    // parentArn equals its own arn) — a self-parent passes validateGraph's
    // existence check but infinite-loops tree-walking layout/UI code. The CFN
    // importer has the equivalent guard (ref !== logicalId).
    if (parentId !== undefined && parentId !== id) instance.parentId = parentId;
    if (res.arn !== undefined) instance.arn = res.arn;

    return instance;
  });

  // Third pass: build relationships, resolving target ARNs to graph ids.
  const relationships: Relationship[] = [];
  const seenEdges = new Set<string>();
  for (const { res, id } of mappable) {
    if (!res.relationships) continue;
    for (const rel of res.relationships) {
      const toId = arnToId.get(rel.targetArn);
      if (!toId) continue; // target not in the discovered set — skip dangling edge
      if (toId === id) continue; // skip self-loops (from === to)
      const kind: RelationshipKind = isRelationshipKind(rel.kind) ? rel.kind : "connects_to";
      // Dedupe by (from, to, kind) so repeated discovery entries don't produce
      // multiple identical edges.
      const edgeKey = `${id} ${toId} ${kind}`;
      if (seenEdges.has(edgeKey)) continue;
      seenEdges.add(edgeKey);
      relationships.push({
        id: generateId(),
        from: id,
        to: toId,
        kind,
        source: "mcp",
      });
    }
  }

  graph.resources = instances;
  graph.relationships = relationships;
  return graph;
}

/**
 * Return the distinct CloudFormation types present in `resources` that have no
 * matching registry entry — i.e. resources `mapDiscoveredToGraph` would skip.
 * Useful for surfacing registry gaps to operators/developers.
 */
export function unmappedTypes(resources: DiscoveredResource[]): string[] {
  const seen = new Set<string>();
  for (const res of resources) {
    if (!getServiceByCfnType(res.resourceType)) seen.add(res.resourceType);
  }
  return [...seen];
}
