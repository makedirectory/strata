/**
 * Cloud Service Registry (multi-cloud)
 * ------------------------------------
 * Aggregates every provider's category catalogs into a single queryable
 * registry. This is the single source of truth for service metadata across
 * AWS, GCP and Azure. The UI, validation engine and IaC/discovery layers all
 * read from here — nothing about a service is hardcoded elsewhere. Adding a
 * service = adding one entry to a catalog file.
 *
 * The cross-provider join key is `nativeType` (CloudFormation type for AWS,
 * Cloud Asset Inventory type for GCP, ARM type for Azure). For AWS entries it
 * falls back to `cfnType`, so the existing AWS catalogs need no edit.
 */
import type { ServiceDefinition, ServiceCategoryId, CloudProvider } from "./types";
import { CATEGORIES } from "./categories";

import networking from "./services/networking";
import compute from "./services/compute";
import containers from "./services/containers";
import storage from "./services/storage";
import database from "./services/database";
import integration from "./services/integration";
import security from "./services/security";
import identity from "./services/identity";
import monitoring from "./services/monitoring";
import analytics from "./services/analytics";
import aiml from "./services/ai-ml";
import deployment from "./services/deployment";
import management from "./services/management";
import edge from "./services/edge";

import GCP_SERVICES from "../gcp/services";
import AZURE_SERVICES from "../azure/services";

/** All AWS catalogs, concatenated. Order roughly follows the palette order. */
const AWS_CATALOGS: ServiceDefinition[][] = [
  networking,
  compute,
  containers,
  storage,
  database,
  integration,
  security,
  identity,
  monitoring,
  analytics,
  aiml,
  deployment,
  management,
  edge,
];

/** Every provider's services, flattened. AWS first (preserves existing order). */
const SERVICES: ServiceDefinition[] = [...AWS_CATALOGS.flat(), ...GCP_SERVICES, ...AZURE_SERVICES];

/** The effective provider of a service (defaults to AWS for back-compat). */
export function serviceProvider(s: ServiceDefinition): CloudProvider {
  return s.provider ?? "aws";
}

/** The cross-provider join key: explicit `nativeType`, else the AWS `cfnType`. */
export function serviceNativeType(s: ServiceDefinition): string | undefined {
  return s.nativeType ?? s.cfnType;
}

/** id → ServiceDefinition index for O(1) lookup. */
const SERVICE_INDEX = new Map<string, ServiceDefinition>(SERVICES.map((s) => [s.id, s]));

/**
 * (provider, nativeType) → ServiceDefinition, the resolver used by IaC import/
 * export and live discovery.
 *
 * `nativeType` is NOT a unique key: the app intentionally models variants of a
 * single native type as distinct services (e.g. public vs private
 * `AWS::EC2::Subnet`, or `AWS::Lambda::Function` as both `lambda` and
 * `lambda-edge`). First-wins strategy: only the first service for a
 * (provider, type) pair is indexed and returned by `getServiceByNativeType`
 * (the canonical variant). The remainder are recorded in
 * `NATIVE_TYPE_COLLISIONS` and surfaced as *warnings* by `validateRegistry()`.
 */
const NATIVE_INDEX = new Map<string, ServiceDefinition>();
const NATIVE_TYPE_COLLISIONS: {
  provider: CloudProvider;
  nativeType: string;
  winnerId: string;
  loserId: string;
}[] = [];

/** Index key for the (provider, type) pair. */
function nativeKey(provider: CloudProvider, nativeType: string): string {
  return `${provider}|${nativeType}`;
}

for (const s of SERVICES) {
  const nativeType = serviceNativeType(s);
  if (!nativeType) continue;
  const provider = serviceProvider(s);
  const key = nativeKey(provider, nativeType);
  const existing = NATIVE_INDEX.get(key);
  if (existing) {
    NATIVE_TYPE_COLLISIONS.push({ provider, nativeType, winnerId: existing.id, loserId: s.id });
  } else {
    NATIVE_INDEX.set(key, s);
  }
}

/**
 * Validate registry integrity at module load (dev-time guardrail). Catches
 * duplicate ids and dangling commonConnections references early.
 */
export interface RegistryIssue {
  level: "error" | "warn";
  message: string;
}

export function validateRegistry(): RegistryIssue[] {
  const issues: RegistryIssue[] = [];
  const seen = new Set<string>();
  for (const s of SERVICES) {
    if (seen.has(s.id)) issues.push({ level: "error", message: `Duplicate service id: ${s.id}` });
    seen.add(s.id);
    if (!CATEGORIES[s.category])
      issues.push({ level: "error", message: `${s.id} has unknown category ${s.category}` });
    for (const c of s.commonConnections) {
      if (!SERVICE_INDEX.has(c.to)) {
        issues.push({
          level: "warn",
          message: `${s.id} → connection target "${c.to}" not found in registry`,
        });
      }
    }
  }
  for (const { provider, nativeType, winnerId, loserId } of NATIVE_TYPE_COLLISIONS) {
    issues.push({
      level: "warn",
      message: `Shared ${provider} type "${nativeType}": "${loserId}" is a variant of "${winnerId}" (first-wins; getServiceByNativeType resolves to "${winnerId}")`,
    });
  }
  return issues;
}

// ----- Public accessors -----------------------------------------------------

export function getService(id: string): ServiceDefinition | undefined {
  return SERVICE_INDEX.get(id);
}

/** Throwing variant for code paths where the id is known-good. */
export function requireService(id: string): ServiceDefinition {
  const s = SERVICE_INDEX.get(id);
  if (!s) throw new Error(`Unknown service id: ${id}`);
  return s;
}

/** Resolve a service from its provider-native resource type (the join key). */
export function getServiceByNativeType(
  provider: CloudProvider,
  nativeType: string,
): ServiceDefinition | undefined {
  return NATIVE_INDEX.get(nativeKey(provider, nativeType));
}

/**
 * AWS-scoped convenience wrapper, preserved for the existing CloudFormation/MCP
 * call sites (`iac.ts`, `mcp.ts`, `iacExport.ts`). Equivalent to
 * `getServiceByNativeType("aws", cfnType)`.
 */
export function getServiceByCfnType(cfnType: string): ServiceDefinition | undefined {
  return getServiceByNativeType("aws", cfnType);
}

/**
 * All registered services as a readonly view, optionally filtered by provider.
 * Returning a `readonly` array prevents callers from mutating the internal
 * `SERVICES` array (push/pop/etc.) and breaking registry integrity.
 */
export function allServices(provider?: CloudProvider): readonly ServiceDefinition[] {
  return provider ? SERVICES.filter((s) => serviceProvider(s) === provider) : SERVICES;
}

export function servicesByCategory(
  category: ServiceCategoryId,
  provider?: CloudProvider,
): ServiceDefinition[] {
  return SERVICES.filter(
    (s) => s.category === category && (!provider || serviceProvider(s) === provider),
  );
}

/** Resolved display colour: per-service override, else the category colour. */
export function serviceColor(id: string): string {
  const s = SERVICE_INDEX.get(id);
  if (!s) return "#8892b0";
  return s.color ?? CATEGORIES[s.category].color;
}

export function serviceIcon(id: string): string {
  return SERVICE_INDEX.get(id)?.icon ?? "❔";
}

/** Build the default config object for a freshly-created resource. */
export function defaultConfig(id: string): Record<string, unknown> {
  const s = SERVICE_INDEX.get(id);
  if (!s) return {};
  const cfg: Record<string, unknown> = {};
  for (const f of s.configFields) {
    if (f.default !== undefined) cfg[f.key] = f.default;
  }
  return cfg;
}

/** Free-text search across name, fullName, description and keywords. */
export function searchServices(query: string, provider?: CloudProvider): ServiceDefinition[] {
  const q = query.trim().toLowerCase();
  const pool = provider ? SERVICES.filter((s) => serviceProvider(s) === provider) : SERVICES;
  // Return a fresh copy (not the internal SERVICES array) so callers can't
  // mutate the registry's backing store; mirrors allServices()'s readonly view.
  if (!q) return [...pool];
  return pool.filter((s) => {
    const hay = [s.name, s.fullName, s.description, s.id, ...(s.keywords ?? [])]
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  });
}

export { SERVICES, CATEGORIES };
