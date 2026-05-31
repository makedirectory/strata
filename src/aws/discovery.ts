/**
 * Strata — Live discovery producer
 * ------------------------------------------------
 * The missing *producer* for `mcp.ts`: turns AWS Cloud Control resource
 * descriptions (fetched live via the SDK, or pasted from
 * `aws cloudcontrol list-resources`) into the `DiscoveredResource[]` that
 * `mapDiscoveredToGraph` already knows how to render.
 *
 * Pure and dependency-free — there is **no `@aws-sdk` import here**. The SDK
 * lives only in the server route (`/api/discover`), which adapts a real
 * `CloudControlClient` to the small `CloudControlLike` interface below. That
 * keeps this module browser-safe and fully unit-testable with fakes/fixtures.
 *
 * Security invariant (carried over from mcp.ts): credentials are never read,
 * returned, or attached to anything here — we only ever handle already-fetched
 * resource descriptions. And because the graph keeps only registry-known
 * config keys, no stray property (a secret, a token) can leak into the model.
 */
import type { DiscoveredResource } from "./mcp";
import { SERVICES, getServiceByCfnType } from "./registry";

/** A registry-backed resource type the discovery scan can map. */
export interface DiscoveryType {
  /** CloudFormation type — the Cloud Control `TypeName` and registry join key. */
  cfnType: string;
  serviceId: string;
  label: string;
  category: string;
}

/** Resource types we can model, derived from the registry (not hand-listed). */
export function listDiscoverableTypes(): DiscoveryType[] {
  const seen = new Set<string>();
  const out: DiscoveryType[] = [];
  for (const s of SERVICES) {
    if (!s.cfnType || seen.has(s.cfnType)) continue;
    // Only the canonical winner for a shared cfnType — variants resolve to it.
    if (getServiceByCfnType(s.cfnType)?.id !== s.id) continue;
    seen.add(s.cfnType);
    out.push({ cfnType: s.cfnType, serviceId: s.id, label: s.name, category: s.category });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

// ---------------------------------------------------------------------------
// Normalisation (lenient → DiscoveredResource)
// ---------------------------------------------------------------------------

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/** Parse a Cloud Control `Properties` value (JSON string or object). */
function parseProps(v: unknown): Record<string, unknown> | undefined {
  if (typeof v === "string") {
    try {
      return asRecord(JSON.parse(v));
    } catch {
      return undefined;
    }
  }
  return asRecord(v);
}

/**
 * Normalise lenient resource records — from the live SDK adapter OR a pasted
 * export — into `DiscoveredResource[]`. Accepts both Strata-native keys
 * (`resourceType`, `properties`, `arn`…) and Cloud Control keys (`TypeName`,
 * `Properties`, `Identifier`). Records without a resolvable type are dropped.
 */
export function normalizeRecords(records: unknown[]): DiscoveredResource[] {
  const out: DiscoveredResource[] = [];
  for (const raw of records) {
    const r = asRecord(raw);
    if (!r) continue;
    const resourceType = str(r.resourceType) ?? str(r.TypeName) ?? str(r.Type);
    if (!resourceType) continue;

    const properties = parseProps(r.properties ?? r.Properties);
    const dr: DiscoveredResource = { resourceType };
    const arn =
      str(r.arn) ?? str(r.Arn) ?? str(properties?.Arn) ?? str(r.Identifier) ?? str(r.identifier);
    const name =
      str(r.name) ??
      str(r.Name) ??
      str(properties?.Name) ??
      str(r.logicalId) ??
      str(r.Identifier) ??
      str(r.identifier);
    if (arn) dr.arn = arn;
    if (name) dr.name = name;
    if (properties) dr.properties = properties;
    const region = str(r.region) ?? str(r.Region);
    if (region) dr.region = region;
    const accountId = str(r.accountId) ?? str(r.AccountId);
    if (accountId) dr.accountId = accountId;
    const parentArn = str(r.parentArn);
    if (parentArn) dr.parentArn = parentArn;
    if (Array.isArray(r.relationships)) {
      const rels = r.relationships
        .map(asRecord)
        .filter((x): x is Record<string, unknown> => Boolean(x))
        .map((rel) => ({ targetArn: str(rel.targetArn) ?? "", kind: str(rel.kind) }))
        .filter((rel) => rel.targetArn);
      if (rels.length) dr.relationships = rels;
    }
    out.push(dr);
  }
  return out;
}

/**
 * Parse a pasted export into discovered resources. Accepts an array of
 * resource records, a Cloud Control `list-resources` object
 * (`{ TypeName, ResourceDescriptions: [...] }`), or `{ resources: [...] }`.
 * Throws on invalid JSON / unrecognised shape (the UI surfaces the message).
 */
export function parsePastedExport(text: string): DiscoveredResource[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  let doc: unknown;
  try {
    doc = JSON.parse(trimmed);
  } catch {
    throw new Error("Not valid JSON.");
  }
  if (Array.isArray(doc)) return normalizeRecords(doc);
  const r = asRecord(doc);
  if (r) {
    if (Array.isArray(r.ResourceDescriptions)) {
      const typeName = str(r.TypeName);
      const recs = r.ResourceDescriptions.map(asRecord)
        .filter((x): x is Record<string, unknown> => Boolean(x))
        .map((d) => ({ TypeName: typeName, Identifier: d.Identifier, Properties: d.Properties }));
      return normalizeRecords(recs);
    }
    if (Array.isArray(r.resources)) return normalizeRecords(r.resources);
  }
  throw new Error(
    "Unrecognised export. Expected a JSON array of resources or Cloud Control list-resources output.",
  );
}

// ---------------------------------------------------------------------------
// Live discovery (against an injected client — the SDK adapter lives in the route)
// ---------------------------------------------------------------------------

/** One Cloud Control resource description (the bits we use). */
export interface CloudControlResourceDescription {
  identifier?: string;
  /** JSON string of the resource's properties, per Cloud Control. */
  properties?: string;
}

/** Minimal Cloud Control surface — implemented by the SDK adapter in the route. */
export interface CloudControlLike {
  listResources(typeName: string, region: string): Promise<CloudControlResourceDescription[]>;
}

export interface DiscoverOptions {
  region: string;
  /** CloudFormation type names to scan. */
  types: string[];
  accountId?: string;
}

export interface DiscoverResult {
  resources: DiscoveredResource[];
  /** Per-type counts so the UI can show exactly what was scanned. */
  scanned: { type: string; count: number }[];
  /** Non-fatal notes (per-type failures, etc.) — never contains credentials. */
  warnings: string[];
}

/**
 * Run a discovery scan through an injected Cloud Control client. Each type is
 * listed independently; a failure on one type is recorded as a warning and the
 * scan continues (no silent caps — every attempted type appears in `scanned`).
 */
export async function discoverWithClient(
  client: CloudControlLike,
  opts: DiscoverOptions,
): Promise<DiscoverResult> {
  const resources: DiscoveredResource[] = [];
  const scanned: { type: string; count: number }[] = [];
  const warnings: string[] = [];
  for (const type of opts.types) {
    try {
      const descs = await client.listResources(type, opts.region);
      const normalized = normalizeRecords(
        descs.map((d) => ({
          TypeName: type,
          Identifier: d.identifier,
          Properties: d.properties,
          region: opts.region,
          accountId: opts.accountId,
        })),
      );
      resources.push(...normalized);
      scanned.push({ type, count: normalized.length });
    } catch (err) {
      scanned.push({ type, count: 0 });
      warnings.push(`Could not list ${type}: ${err instanceof Error ? err.message : "error"}`);
    }
  }
  return { resources, scanned, warnings };
}
