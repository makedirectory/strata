/**
 * Microsoft Azure — live discovery producer (Azure Resource Graph).
 * -----------------------------------------------------------------
 * The Azure analog of the AWS Cloud Control producer. Azure Resource Graph is a
 * single KQL API that returns every resource across subscriptions, keyed by ARM
 * `type` (e.g. "Microsoft.Compute/virtualMachines") — exactly our Azure
 * `nativeType` join key. Pure and dependency-free: there is **no `@azure/*`
 * import here**. The SDK (`@azure/arm-resourcegraph` + `@azure/identity`) lives
 * only in the server route, which queries with the user's ambient
 * DefaultAzureCredential and hands already-fetched rows to `normalizeRows`.
 *
 * Security invariant (carried over from mcp.ts): credentials/tokens are never
 * read, returned, or attached to anything here — only already-fetched rows.
 */
import type { DiscoveredResource } from "../aws/mcp";
import { allServices, getServiceByNativeType, serviceNativeType } from "../aws/registry";

/** A registry-backed Azure ARM type the discovery scan can map. */
export interface AzureDiscoveryType {
  /** ARM resource type — the registry join key. */
  armType: string;
  serviceId: string;
  label: string;
  category: string;
}

/** Azure ARM types we can model, derived from the registry (not hand-listed). */
export function listAzureDiscoverableTypes(): AzureDiscoveryType[] {
  const seen = new Set<string>();
  const out: AzureDiscoveryType[] = [];
  for (const s of allServices("azure")) {
    const armType = serviceNativeType(s);
    if (!armType || seen.has(armType)) continue;
    if (getServiceByNativeType("azure", armType)?.id !== s.id) continue;
    seen.add(armType);
    out.push({ armType, serviceId: s.id, label: s.name, category: s.category });
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

/**
 * Normalise Azure Resource Graph rows (from the SDK adapter or a pasted
 * `az graph query` export) into `DiscoveredResource[]`. Each row carries ARM
 * `type`, `id`, `name`, `location`, `resourceGroup`, `properties`. The resource
 * group becomes the containment parent. Records without a type are dropped;
 * every result is tagged `provider: "azure"`.
 */
export function normalizeRows(records: unknown[]): DiscoveredResource[] {
  const out: DiscoveredResource[] = [];
  for (const raw of records) {
    const r = asRecord(raw);
    if (!r) continue;
    const resourceType = str(r.type) ?? str(r.resourceType);
    if (!resourceType) continue;

    const dr: DiscoveredResource = { resourceType, provider: "azure" };
    const id = str(r.id) ?? str(r.resourceId);
    const name = str(r.name) ?? str(r.displayName);
    if (id) dr.arn = id; // ARM resource id is the stable identifier
    if (name) dr.name = name;
    const properties = asRecord(r.properties);
    if (properties) dr.properties = properties;
    const region = str(r.location);
    if (region) dr.region = region;
    const subscriptionId = str(r.subscriptionId);
    if (subscriptionId) dr.accountId = subscriptionId;
    // Containment: the resource group is the mandatory Azure parent.
    const rg = str(r.resourceGroup);
    if (rg) dr.parentArn = rg;
    out.push(dr);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Live discovery (against an injected client — the SDK adapter lives in the route)
// ---------------------------------------------------------------------------

/** Minimal Resource Graph surface — implemented by the SDK adapter in the route. */
export interface ResourceGraphClientLike {
  /** Run a KQL query across the given subscriptions, returning result rows. */
  query(kql: string, subscriptions: string[]): Promise<Record<string, unknown>[]>;
}

export interface AzureDiscoverOptions {
  subscriptions: string[];
  /** ARM types to include; empty ⇒ all modeled types. */
  types: string[];
}

export interface AzureDiscoverResult {
  resources: DiscoveredResource[];
  scanned: { subscriptions: number; count: number };
  /** Non-fatal notes — never contains credentials. */
  warnings: string[];
}

/** Build the Resource Graph KQL for the requested types (no creds involved). */
export function buildResourceGraphQuery(types: string[]): string {
  const base =
    "Resources | project id, name, type, location, resourceGroup, subscriptionId, properties";
  if (types.length === 0) return base;
  const list = types.map((t) => `'${t.toLowerCase()}'`).join(", ");
  return `Resources | where tolower(type) in (${list}) | project id, name, type, location, resourceGroup, subscriptionId, properties`;
}

/** Run a Resource Graph discovery scan through an injected client. */
export async function discoverAzureWithClient(
  client: ResourceGraphClientLike,
  opts: AzureDiscoverOptions,
): Promise<AzureDiscoverResult> {
  const warnings: string[] = [];
  try {
    const rows = await client.query(buildResourceGraphQuery(opts.types), opts.subscriptions);
    const resources = normalizeRows(rows);
    return {
      resources,
      scanned: { subscriptions: opts.subscriptions.length, count: resources.length },
      warnings,
    };
  } catch (err) {
    warnings.push(`Resource Graph query failed: ${err instanceof Error ? err.message : "error"}`);
    return {
      resources: [],
      scanned: { subscriptions: opts.subscriptions.length, count: 0 },
      warnings,
    };
  }
}
