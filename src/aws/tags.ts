/**
 * Tag layer — pure, framework-free tag math over an InfrastructureGraph.
 *
 * Resources carry optional AWS-style `tags: Record<string,string>`. This engine
 * turns that flat key/value space into the primitives a tag-driven UI needs:
 *   - `collectTagKeys`   — the sorted set of every tag key in use,
 *   - `collectTagValues` — the sorted set of values seen for one key,
 *   - `tagTintMap`       — a STABLE colour per distinct value of one key, so a
 *                          renderer can tint nodes by tag and re-runs match,
 *   - `filterByTag`      — a NEW graph containing only resources matching one
 *                          key=value pair, with relationships honestly pruned to
 *                          those whose endpoints both survive.
 *
 * Scope: self-contained. No DOM, no network, no credentials, and no dependency
 * on other engines — the colour palette is implemented locally (a deterministic
 * hash → fixed palette) rather than borrowing `overlays.heatColor`, so tag tints
 * are categorical (stable per value) instead of a continuous heat ramp. Nothing
 * here mutates its input; the filter returns a fresh graph object.
 */
import type { InfrastructureGraph, ResourceInstance, Relationship } from "./model";

/**
 * Categorical tint palette. Twelve visually-distinct hues; distinct tag values
 * map onto these by a deterministic hash so colours stay stable across runs and
 * across sessions (no random/seq assignment). Chosen to read clearly on both
 * light and dark canvases — mirrors the saturation/lightness band of the
 * service colours used elsewhere.
 */
const TINT_PALETTE: readonly string[] = [
  "#3b82f6", // blue
  "#10b981", // emerald
  "#f59e0b", // amber
  "#ef4444", // red
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#14b8a6", // teal
  "#f97316", // orange
  "#6366f1", // indigo
  "#84cc16", // lime
  "#06b6d4", // cyan
  "#a855f7", // purple
] as const;

/**
 * True when a resource has the tag `key` set to a non-empty string. Tags are
 * `Record<string,string>`, but graphs round-tripped through untrusted IaC/JSON
 * can smuggle non-string or empty values, so we guard rather than trust.
 */
function hasTag(r: ResourceInstance, key: string): boolean {
  const v = r.tags?.[key];
  return typeof v === "string" && v.length > 0;
}

/** True when a resource carries at least one non-empty tag of any key. */
function hasAnyTag(r: ResourceInstance): boolean {
  const tags = r.tags;
  if (!tags) return false;
  for (const v of Object.values(tags)) {
    if (typeof v === "string" && v.length > 0) return true;
  }
  return false;
}

/**
 * Deterministic 32-bit string hash (FNV-1a). Used to pick a palette slot for a
 * tag value so the same value always lands on the same colour, independent of
 * iteration order or how many other values exist.
 */
function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    // 32-bit FNV prime multiply, kept in unsigned range.
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Stable categorical colour for an arbitrary value string. */
function tintForValue(value: string): string {
  return TINT_PALETTE[hashString(value) % TINT_PALETTE.length];
}

/**
 * Sorted, de-duplicated list of every tag key used by any resource in the
 * graph. Empty when no resource carries tags.
 */
export function collectTagKeys(graph: InfrastructureGraph): string[] {
  const keys = new Set<string>();
  for (const r of graph.resources) {
    const tags = r.tags;
    if (!tags) continue;
    for (const [k, v] of Object.entries(tags)) {
      // Only surface keys with a non-empty string value, matching `hasTag`.
      if (typeof v === "string" && v.length > 0) keys.add(k);
    }
  }
  return [...keys].sort();
}

/**
 * Sorted, de-duplicated list of the values seen for a single tag `key` across
 * the graph. Empty when no resource carries that key.
 */
export function collectTagValues(graph: InfrastructureGraph, key: string): string[] {
  const values = new Set<string>();
  for (const r of graph.resources) {
    const v = r.tags?.[key];
    if (typeof v === "string" && v.length > 0) values.add(v);
  }
  return [...values].sort();
}

/**
 * Map of `resourceId → colour hex` assigning a stable categorical colour per
 * distinct value of `key`. Only resources that carry a non-empty value for
 * `key` are included — resources missing the key are absent from the map (so a
 * renderer leaves them un-tinted). Colour is a pure function of the value, so
 * re-runs and re-renders produce identical maps.
 */
export function tagTintMap(graph: InfrastructureGraph, key: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of graph.resources) {
    if (!hasTag(r, key)) continue;
    out.set(r.id, tintForValue(r.tags![key]));
  }
  return out;
}

/**
 * A NEW graph containing only the resources whose `tags[key]` is a non-empty
 * string equal to `value`, with relationships pruned to those whose `from` AND
 * `to` both survive — never leaving a dangling edge reference. The non-empty
 * string guard mirrors `hasTag`/`collectTagValues`/`tagTintMap`, so the filter
 * matches exactly the values the UI lists for a key (empty-string and
 * non-string smuggled values never match). Accounts, viewport, and other top-level
 * fields are carried through unchanged. The input graph is never mutated; the
 * returned `resources`/`relationships` are fresh arrays (the element objects are
 * shared by reference, so callers must treat them as read-only, matching the
 * convention of the `model.ts` helpers).
 */
export function filterByTag(
  graph: InfrastructureGraph,
  key: string,
  value: string,
): InfrastructureGraph {
  const resources: ResourceInstance[] = graph.resources.filter(
    (r) => hasTag(r, key) && r.tags![key] === value,
  );
  const surviving = new Set(resources.map((r) => r.id));
  const relationships: Relationship[] = graph.relationships.filter(
    (e) => surviving.has(e.from) && surviving.has(e.to),
  );
  return { ...graph, resources, relationships };
}

/**
 * Tag-coverage summary: how many resources carry at least one non-empty tag vs
 * none, and the resulting fraction in [0,1]. A convenience for hygiene panels;
 * `coverage` is 0 for an empty graph (no resources to tag).
 */
export function tagCoverage(graph: InfrastructureGraph): {
  tagged: number;
  untagged: number;
  coverage: number;
} {
  let tagged = 0;
  for (const r of graph.resources) {
    if (hasAnyTag(r)) tagged++;
  }
  const total = graph.resources.length;
  const untagged = total - tagged;
  return { tagged, untagged, coverage: total === 0 ? 0 : tagged / total };
}
