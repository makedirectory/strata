/**
 * Drift detection — compare a diagram against a baseline graph (e.g. live cloud
 * state from discovery, or a target IaC import) and report what differs.
 *
 * Pure and framework-free. "Drift" is computed as `current` (your diagram)
 * relative to `baseline` (the source of truth you're comparing against):
 *   - added    — in current, missing from baseline
 *   - removed  — in baseline, missing from current
 *   - changed  — matched in both, but config differs
 *   - unchanged— matched, identical config
 *
 * Resources rarely share ids across sources (a diagram uses UUIDs; an import
 * uses logical ids/addresses), so matching falls back from `id` to a stable
 * identity key: the `arn` when present, else `serviceId + name`.
 */
import type { InfrastructureGraph, ResourceInstance } from "./model";

export interface DriftRef {
  id: string;
  name: string;
  serviceId: string;
}
export interface DriftConfigChange {
  key: string;
  from: unknown;
  to: unknown;
}
export interface DriftChanged extends DriftRef {
  changes: DriftConfigChange[];
}
export interface DriftResult {
  added: DriftRef[];
  removed: DriftRef[];
  changed: DriftChanged[];
  unchanged: number;
  /** True when nothing differs. */
  inSync: boolean;
}

const ref = (r: ResourceInstance): DriftRef => ({
  id: r.id,
  name: r.name,
  serviceId: r.serviceId,
});

/** Stable cross-source identity: ARN if known, else serviceId + lowercased name. */
function identityKey(r: ResourceInstance): string {
  if (typeof r.arn === "string" && r.arn) return `arn:${r.arn}`;
  return `${r.serviceId}::${(r.name ?? "").trim().toLowerCase()}`;
}

/** Config differences between two resources (union of keys, JSON-equality). */
function diffConfig(
  from: Record<string, unknown>,
  to: Record<string, unknown>,
): DriftConfigChange[] {
  const keys = new Set([...Object.keys(from ?? {}), ...Object.keys(to ?? {})]);
  const changes: DriftConfigChange[] = [];
  for (const key of [...keys].sort()) {
    const a = from?.[key];
    const b = to?.[key];
    if (JSON.stringify(a) !== JSON.stringify(b)) changes.push({ key, from: a, to: b });
  }
  return changes;
}

/** Compare `current` against `baseline`, returning added/removed/changed. */
export function diffGraphs(
  current: InfrastructureGraph,
  baseline: InfrastructureGraph,
): DriftResult {
  const baseById = new Map(baseline.resources.map((r) => [r.id, r]));
  const baseByKey = new Map<string, ResourceInstance>();
  for (const r of baseline.resources) {
    const k = identityKey(r);
    if (!baseByKey.has(k)) baseByKey.set(k, r);
  }

  const added: DriftRef[] = [];
  const changed: DriftChanged[] = [];
  const matchedBaseIds = new Set<string>();
  let unchanged = 0;

  for (const c of current.resources) {
    let match = baseById.get(c.id);
    if (match && matchedBaseIds.has(match.id)) match = undefined;
    if (!match) {
      const cand = baseByKey.get(identityKey(c));
      if (cand && !matchedBaseIds.has(cand.id)) match = cand;
    }
    if (!match) {
      added.push(ref(c));
      continue;
    }
    matchedBaseIds.add(match.id);
    const changes = diffConfig(match.config, c.config);
    if (changes.length) changed.push({ ...ref(c), changes });
    else unchanged++;
  }

  const removed = baseline.resources.filter((b) => !matchedBaseIds.has(b.id)).map(ref);

  return {
    added,
    removed,
    changed,
    unchanged,
    inSync: added.length === 0 && removed.length === 0 && changed.length === 0,
  };
}
