/**
 * Runtime shape validation for `InfrastructureGraph`.
 * ---------------------------------------------------
 * The domain model in `aws/model` is a compile-time contract only. Data that
 * crosses a trust boundary — request bodies and JSON files on disk — must be
 * checked at runtime before it is treated as an `InfrastructureGraph`, since a
 * bare type assertion lets missing/wrong fields through and causes silent data
 * loss or downstream crashes (e.g. `validateGraph` reading `g.resources`).
 *
 * This is a lightweight structural check (no external schema dependency).
 * Swap in zod/io-ts here if richer validation is ever required.
 */
import type { InfrastructureGraph } from "../aws/model";

/** True for plain (non-null, non-array) objects — safe to read keys from. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Hard upper bound on the number of elements in any single graph collection.
 * Guards against pathological/oversized payloads exhausting memory or disk on
 * write. Generous relative to any realistic architecture diagram.
 */
export const MAX_COLLECTION_LENGTH = 10_000;

/**
 * Verify an unknown value has the required `InfrastructureGraph` fields with
 * the right primitive/array types. Element-level integrity (dangling refs,
 * duplicate ids) is left to `validateGraph`.
 */
export function isInfrastructureGraph(value: unknown): value is InfrastructureGraph {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.schemaVersion === "number" &&
    Array.isArray(value.accounts) &&
    Array.isArray(value.resources) &&
    Array.isArray(value.relationships)
  );
}

/**
 * Variant that tolerates a server-assigned `id` (empty before persist) and a
 * server-assigned `schemaVersion`. Used for write request bodies, where the
 * repository stamps `id`/`schemaVersion`/timestamps. Requires the collection
 * arrays so `validateGraph` and persistence never see `undefined`.
 *
 * Rejects collections that are present but the wrong type (e.g.
 * `resources: "x"` or `accounts: {}`) so malformed input fails at the trust
 * boundary as a 422 rather than crashing downstream as a 500.
 */
export function hasGraphCollections(
  value: unknown,
): value is Pick<InfrastructureGraph, "name" | "accounts" | "resources" | "relationships"> {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    Array.isArray(value.accounts) &&
    Array.isArray(value.resources) &&
    Array.isArray(value.relationships)
  );
}

/**
 * Reject a write body whose collections exceed `MAX_COLLECTION_LENGTH`.
 * Returns an error message, or `null` when within limits. Assumes the
 * collections are already known to be arrays (call after `hasGraphCollections`
 * or array narrowing). Routes map a non-null result to 413/422.
 */
export function checkCollectionLimits(value: {
  accounts: unknown[];
  resources: unknown[];
  relationships: unknown[];
}): string | null {
  const over = (["accounts", "resources", "relationships"] as const).find(
    (k) => value[k].length > MAX_COLLECTION_LENGTH,
  );
  if (over) {
    return `Graph ${over} exceeds the maximum of ${MAX_COLLECTION_LENGTH} entries`;
  }
  return null;
}

/**
 * Validate the optional writable fields (`description`, `viewport`) when
 * present. Returns an error message, or `null` when valid/absent. Prevents
 * wrong-typed optional fields (e.g. `description: 123`, `viewport: "x"`) from
 * being persisted. Routes map a non-null result to 422.
 */
export function checkOptionalFields(body: Record<string, unknown>): string | null {
  if ("description" in body && body.description !== undefined) {
    if (typeof body.description !== "string") return "description must be a string";
  }
  if ("viewport" in body && body.viewport !== undefined) {
    const v = body.viewport;
    if (
      !isRecord(v) ||
      typeof v.x !== "number" ||
      typeof v.y !== "number" ||
      typeof v.scale !== "number"
    ) {
      return "viewport must be an object with numeric x, y and scale";
    }
  }
  return null;
}

/** Client-supplied fields a caller may set when creating/replacing a graph. */
export const WRITABLE_FIELDS = [
  "name",
  "description",
  "accounts",
  "resources",
  "relationships",
  "viewport",
] as const satisfies readonly (keyof InfrastructureGraph)[];

/**
 * Project a request body onto the writable graph fields, dropping anything
 * else (id, schemaVersion, timestamps are server-owned). Only copies keys the
 * client actually provided so `emptyGraph` defaults survive for the rest.
 *
 * Shared by POST /api/graphs and PUT /api/graphs/[id] so neither route can
 * persist unvalidated/extra fields by spreading the raw body.
 */
export function pickWritableFields(body: Record<string, unknown>): Partial<InfrastructureGraph> {
  const picked: Partial<InfrastructureGraph> = {};
  for (const key of WRITABLE_FIELDS) {
    if (key in body) {
      // Trusted-shape narrowing happens in validateGraph at the call site.
      (picked as Record<string, unknown>)[key] = body[key];
    }
  }
  return picked;
}
