/**
 * AWS Service Registry
 * --------------------
 * Aggregates every category catalog into a single queryable registry.
 *
 * This is the single source of truth for service metadata. The UI, validation
 * engine and MCP importer all read from here — nothing about a service is
 * hardcoded elsewhere. Adding a service = adding one entry to a catalog file.
 */
import type { ServiceDefinition, ServiceCategoryId } from "./types";
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

/** All catalogs, concatenated. Order roughly follows the palette order. */
const ALL_CATALOGS: ServiceDefinition[][] = [
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

const SERVICES: ServiceDefinition[] = ALL_CATALOGS.flat();

/** id → ServiceDefinition index for O(1) lookup. */
const SERVICE_INDEX = new Map<string, ServiceDefinition>(SERVICES.map((s) => [s.id, s]));

/**
 * CloudFormation type → ServiceDefinition (used by the MCP/import mapper).
 *
 * `cfnType` is NOT a unique key: the app intentionally models variants of a
 * single CloudFormation type as distinct services (e.g. public vs private
 * `AWS::EC2::Subnet`, or `AWS::Lambda::Function` as both `lambda` and
 * `lambda-edge`). First-wins strategy: when several services share a `cfnType`
 * only the first is indexed and returned by `getServiceByCfnType` (the
 * canonical variant). The remainder are recorded in `CFN_TYPE_COLLISIONS` and
 * surfaced as *warnings* by `validateRegistry()` so they are visible without
 * being treated as integrity errors. MCP import maps to the canonical variant;
 * a downstream refinement step can reclassify by inspecting properties.
 */
const CFN_INDEX = new Map<string, ServiceDefinition>();
const CFN_TYPE_COLLISIONS: { cfnType: string; winnerId: string; loserId: string }[] = [];
for (const s of SERVICES) {
  if (!s.cfnType) continue;
  const existing = CFN_INDEX.get(s.cfnType);
  if (existing) {
    CFN_TYPE_COLLISIONS.push({ cfnType: s.cfnType, winnerId: existing.id, loserId: s.id });
  } else {
    CFN_INDEX.set(s.cfnType, s);
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
  for (const { cfnType, winnerId, loserId } of CFN_TYPE_COLLISIONS) {
    issues.push({
      level: "warn",
      message: `Shared cfnType "${cfnType}": "${loserId}" is a variant of "${winnerId}" (first-wins; getServiceByCfnType resolves to "${winnerId}")`,
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

export function getServiceByCfnType(cfnType: string): ServiceDefinition | undefined {
  return CFN_INDEX.get(cfnType);
}

/**
 * All registered services as a readonly view. Returning a `readonly` array
 * prevents callers from mutating the internal `SERVICES` array (push/pop/etc.)
 * and breaking registry integrity.
 */
export function allServices(): readonly ServiceDefinition[] {
  return SERVICES;
}

export function servicesByCategory(category: ServiceCategoryId): ServiceDefinition[] {
  return SERVICES.filter((s) => s.category === category);
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
export function searchServices(query: string): ServiceDefinition[] {
  const q = query.trim().toLowerCase();
  // Return a fresh copy (not the internal SERVICES array) so callers can't
  // mutate the registry's backing store; mirrors allServices()'s readonly view.
  if (!q) return [...SERVICES];
  return SERVICES.filter((s) => {
    const hay = [s.name, s.fullName, s.description, s.id, ...(s.keywords ?? [])]
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  });
}

export { SERVICES, CATEGORIES };
