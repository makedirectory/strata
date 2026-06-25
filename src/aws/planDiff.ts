/**
 * Terraform/OpenTofu plan diff (pure).
 * ------------------------------------
 * A `terraform show -json <planfile>` document carries two things we care about:
 *
 *   - `planned_values.root_module` — the resulting resource tree, which
 *     `importTerraform` already turns into a graph.
 *   - `resource_changes[]` — per-resource **actions** (`create`/`update`/`delete`/
 *     `read`/`no-op`, with `["delete","create"]` meaning a replace).
 *
 * This module reads the second part into a per-address change map keyed the same
 * way `importTerraform` addresses resources, so the result lines up 1:1 with graph
 * node ids and can drive the "plan" overlay. It is **pure** — the caller obtains
 * the plan JSON (see `src/server/runPlan.ts`).
 */
import { isRecord } from "./iac";

/** How a resource changes in a plan. `replace` = destroy-then-create. */
export type ChangeKind = "create" | "update" | "delete" | "replace" | "read" | "noop";

export interface PlanDiff {
  /** Resource address (Terraform-style, = graph node id) → change kind. */
  changes: Record<string, ChangeKind>;
  /** Tally per kind, for a summary line. */
  counts: Record<ChangeKind, number>;
}

const EMPTY_COUNTS = (): Record<ChangeKind, number> => ({
  create: 0,
  update: 0,
  delete: 0,
  replace: 0,
  read: 0,
  noop: 0,
});

/** Map a Terraform `change.actions` array to a single ChangeKind. */
export function actionsToKind(actions: readonly unknown[]): ChangeKind {
  const a = actions.filter((x): x is string => typeof x === "string");
  // A replace is the pair delete+create (order varies: create-before-destroy).
  if (a.includes("delete") && a.includes("create")) return "replace";
  if (a.includes("create")) return "create";
  if (a.includes("delete")) return "delete";
  if (a.includes("update")) return "update";
  if (a.includes("read")) return "read";
  return "noop";
}

/**
 * Extract the per-resource change map from a plan JSON document. Unknown shapes
 * yield an empty diff rather than throwing (the graph still renders).
 */
export function planDiff(tf: unknown): PlanDiff {
  const changes: Record<string, ChangeKind> = {};
  const counts = EMPTY_COUNTS();
  if (!isRecord(tf) || !Array.isArray(tf.resource_changes)) return { changes, counts };

  for (const rc of tf.resource_changes) {
    if (!isRecord(rc)) continue;
    const address =
      typeof rc.address === "string"
        ? rc.address
        : typeof rc.type === "string"
          ? `${rc.type}.${String(rc.name)}`
          : undefined;
    if (!address) continue;
    const change = isRecord(rc.change) ? rc.change : {};
    const actions = Array.isArray(change.actions) ? change.actions : [];
    const kind = actionsToKind(actions);
    changes[address] = kind;
    counts[kind] += 1;
  }
  return { changes, counts };
}

/** Re-key a diff into a namespace (e.g. per-root layer: `prod::<address>`). */
export function namespacePlanDiff(diff: PlanDiff, prefix: string): PlanDiff {
  const changes: Record<string, ChangeKind> = {};
  for (const [addr, kind] of Object.entries(diff.changes)) changes[`${prefix}${addr}`] = kind;
  return { changes, counts: diff.counts };
}

/** Merge several plan diffs into one (counts summed, change maps unioned). */
export function mergePlanDiffs(diffs: readonly PlanDiff[]): PlanDiff {
  const changes: Record<string, ChangeKind> = {};
  const counts = EMPTY_COUNTS();
  for (const d of diffs) {
    Object.assign(changes, d.changes);
    for (const k of Object.keys(counts) as ChangeKind[]) counts[k] += d.counts[k];
  }
  return { changes, counts };
}
