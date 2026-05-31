/**
 * Google Cloud — live discovery producer (Cloud Asset Inventory).
 * ---------------------------------------------------------------
 * The GCP analog of the AWS Cloud Control producer (`src/aws/discovery.ts`).
 * Cloud Asset Inventory (CAI) is a single API that enumerates every asset in a
 * project/folder/org, keyed by **asset type** (e.g.
 * "compute.googleapis.com/Instance") — which is exactly our GCP `nativeType`
 * join key. This module is pure and dependency-free: there is **no
 * `@google-cloud/asset` import here**. The SDK lives only in the server route,
 * which fetches assets with the user's ambient Application Default Credentials
 * and hands already-fetched descriptions to `normalizeAssets`.
 *
 * Security invariant (carried over from mcp.ts): credentials are never read,
 * returned, or attached to anything here — only already-fetched asset data.
 */
import type { DiscoveredResource } from "../aws/mcp";
import { allServices, getServiceByNativeType, serviceNativeType } from "../aws/registry";

/** A registry-backed GCP asset type the discovery scan can map. */
export interface GcpDiscoveryType {
  /** Cloud Asset Inventory asset type — the registry join key. */
  assetType: string;
  serviceId: string;
  label: string;
  category: string;
}

/** GCP asset types we can model, derived from the registry (not hand-listed). */
export function listGcpDiscoverableTypes(): GcpDiscoveryType[] {
  const seen = new Set<string>();
  const out: GcpDiscoveryType[] = [];
  for (const s of allServices("gcp")) {
    const assetType = serviceNativeType(s);
    if (!assetType || seen.has(assetType)) continue;
    // Only the canonical winner for a shared type — variants resolve to it.
    if (getServiceByNativeType("gcp", assetType)?.id !== s.id) continue;
    seen.add(assetType);
    out.push({ assetType, serviceId: s.id, label: s.name, category: s.category });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/** Short, human display name from a full CAI resource name. */
function shortName(fullName: string | undefined): string | undefined {
  if (!fullName) return undefined;
  const parts = fullName.split("/");
  return parts[parts.length - 1] || fullName;
}

/**
 * Normalise Cloud Asset Inventory assets (from the SDK adapter or a pasted
 * `gcloud asset list --format=json` export) into `DiscoveredResource[]`.
 * Accepts CAI keys (`assetType`, `resource.data`, `resource.parent`) and
 * Strata-native keys (`resourceType`, `properties`). Records without a
 * resolvable type are dropped. Every result is tagged `provider: "gcp"`.
 */
export function normalizeAssets(records: unknown[]): DiscoveredResource[] {
  const out: DiscoveredResource[] = [];
  for (const raw of records) {
    const r = asRecord(raw);
    if (!r) continue;
    const resourceType = str(r.assetType) ?? str(r.resourceType) ?? str(r.type);
    if (!resourceType) continue;

    const resource = asRecord(r.resource);
    const properties =
      asRecord(r.properties) ?? asRecord(resource?.data) ?? asRecord(r.data) ?? undefined;
    const fullName = str(r.name) ?? str(resource?.name);
    const dr: DiscoveredResource = { resourceType, provider: "gcp" };
    const name = str(r.displayName) ?? shortName(fullName) ?? str(properties?.name);
    if (fullName) dr.arn = fullName; // full resource name acts as the stable id
    if (name) dr.name = name;
    if (properties) dr.properties = properties;
    const region = str(r.location) ?? str(resource?.location);
    if (region) dr.region = region;
    const parent = str(resource?.parent) ?? str(r.parent);
    if (parent) dr.parentArn = parent;
    out.push(dr);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Live discovery (against an injected client — the SDK adapter lives in the route)
// ---------------------------------------------------------------------------

/** One Cloud Asset Inventory asset (the bits we use). */
export interface CloudAsset {
  name?: string;
  assetType?: string;
  resource?: { data?: Record<string, unknown>; parent?: string; location?: string };
}

/** Minimal CAI surface — implemented by the `@google-cloud/asset` adapter in the route. */
export interface CloudAssetClientLike {
  /** List assets of the given types within the scope (project/folder/org). */
  listAssets(scope: string, assetTypes: string[]): Promise<CloudAsset[]>;
}

export interface GcpDiscoverOptions {
  /** "projects/my-project" | "folders/123" | "organizations/456". */
  scope: string;
  assetTypes: string[];
}

export interface GcpDiscoverResult {
  resources: DiscoveredResource[];
  scanned: { scope: string; count: number };
  /** Non-fatal notes — never contains credentials. */
  warnings: string[];
}

/**
 * Run a CAI discovery scan through an injected client. A failure is recorded as
 * a warning rather than thrown, so the UI can surface partial results.
 */
export async function discoverGcpWithClient(
  client: CloudAssetClientLike,
  opts: GcpDiscoverOptions,
): Promise<GcpDiscoverResult> {
  const warnings: string[] = [];
  try {
    const assets = await client.listAssets(opts.scope, opts.assetTypes);
    const resources = normalizeAssets(assets as unknown[]);
    return { resources, scanned: { scope: opts.scope, count: resources.length }, warnings };
  } catch (err) {
    warnings.push(
      `Could not list assets in ${opts.scope}: ${err instanceof Error ? err.message : "error"}`,
    );
    return { resources: [], scanned: { scope: opts.scope, count: 0 }, warnings };
  }
}
