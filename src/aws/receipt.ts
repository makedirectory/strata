/**
 * Change/audit receipt — a deterministic, human-readable diff of two graphs.
 * --------------------------------------------------------------------------
 * Composes the existing pure engines to answer "what changed, and what did it
 * cost/fix/break?" between a `before` and an `after` snapshot:
 *   - resource churn  → {@link diffGraphs} (drift.ts): added / removed / changed
 *   - cost delta      → {@link estimateTotal} (cost.ts): before vs after totals
 *                       plus how many resources were unpriced on each side
 *   - findings delta  → {@link validateArchitecture} (rules.ts): which
 *                       validation findings were resolved vs introduced, keyed
 *                       on a stable identity tuple (level + message + resourceId)
 *
 * This engine NEVER re-implements drift/cost/rule logic — it only differences
 * and formats their outputs. It carries finding `message` text through purely as
 * display strings; it does not parse messages to derive logic.
 *
 * Intentionally side-effect-free and reproducible: no signing, no persistence,
 * no timestamps, no randomness. The same `(before, after)` always yields the
 * same receipt, byte-for-byte, so receipts diff cleanly in review.
 */
import type { InfrastructureGraph } from "./model";
import { diffGraphs, type DriftResult } from "./drift";
import { estimateTotal, formatMonthly } from "./cost";
import { validateArchitecture, type ValidationResult } from "./rules";

/** Validation findings that disappeared vs appeared between the two graphs. */
export interface FindingDelta {
  /** Display messages present in `before` but absent in `after`. Sorted. */
  resolved: string[];
  /** Display messages present in `after` but absent in `before`. Sorted. */
  introduced: string[];
  /** Count of findings present, unchanged, in both graphs. */
  unchanged: number;
}

/** Estimated monthly spend on each side, with the signed delta. */
export interface CostDelta {
  before: number;
  after: number;
  /** `after - before` (positive = more expensive). */
  delta: number;
  /** Resources with no cost model in `before`. */
  beforeUnknown: number;
  /** Resources with no cost model in `after`. */
  afterUnknown: number;
}

/** Full receipt: drift + cost delta + findings delta + plain-English summary. */
export interface ChangeReceipt {
  drift: DriftResult;
  cost: CostDelta;
  findings: FindingDelta;
  /** Deterministic, ordered, human-readable one-liners describing the change. */
  summaryLines: string[];
}

/**
 * Stable identity for a validation finding so the same logical finding matches
 * across the two graphs. We treat `ok`-level results as non-findings (they carry
 * no actionable signal) and only track `error`/`warn`.
 */
function findingKey(v: ValidationResult): string {
  // JSON.stringify of the identity tuple is collision-safe (delimiters can't be
  // forged by field content) and stays printable, so the source file diffs/blames
  // cleanly rather than being treated as binary.
  return JSON.stringify([v.level, v.message, v.resourceId ?? ""]);
}

/** Display text for a finding — the level prefix keeps messages disambiguated. */
function findingLabel(v: ValidationResult): string {
  return `[${v.level}] ${v.message}`;
}

/** Build a key→label map of actionable (non-`ok`) findings for one graph. */
function actionableFindings(graph: InfrastructureGraph): Map<string, string> {
  const out = new Map<string, string>();
  for (const v of validateArchitecture(graph)) {
    if (v.level === "ok") continue;
    out.set(findingKey(v), findingLabel(v));
  }
  return out;
}

/**
 * Produce the change receipt comparing `after` against `before`.
 *
 * Drift is computed as `diffGraphs(after, before)` so that "added" means
 * present in the new graph (added by the change) and "removed" means dropped by
 * the change — reading naturally as a forward diff of the edit.
 */
export function changeReceipt(
  before: InfrastructureGraph,
  after: InfrastructureGraph,
): ChangeReceipt {
  const drift = diffGraphs(after, before);

  const beforeTotal = estimateTotal(before.resources);
  const afterTotal = estimateTotal(after.resources);
  const cost: CostDelta = {
    before: beforeTotal.total,
    after: afterTotal.total,
    delta: afterTotal.total - beforeTotal.total,
    beforeUnknown: beforeTotal.unknown,
    afterUnknown: afterTotal.unknown,
  };

  const beforeFindings = actionableFindings(before);
  const afterFindings = actionableFindings(after);
  const resolved: string[] = [];
  const introduced: string[] = [];
  let unchanged = 0;
  for (const [key, label] of beforeFindings) {
    if (afterFindings.has(key)) unchanged++;
    else resolved.push(label);
  }
  for (const [key, label] of afterFindings) {
    if (!beforeFindings.has(key)) introduced.push(label);
  }
  resolved.sort();
  introduced.sort();
  const findings: FindingDelta = { resolved, introduced, unchanged };

  return { drift, cost, findings, summaryLines: buildSummaryLines(drift, cost, findings) };
}

/** Pluralize a count noun deterministically (no Intl, no locale dependence). */
function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/**
 * Build the ordered, human-readable summary: resource churn, cost movement, then
 * findings movement. Lines are emitted in a fixed order and omitted only when
 * fully zero, so the list stays compact yet deterministic.
 */
function buildSummaryLines(drift: DriftResult, cost: CostDelta, findings: FindingDelta): string[] {
  const lines: string[] = [];

  // --- resource churn ---
  const churn: string[] = [];
  if (drift.added.length) churn.push(`+${plural(drift.added.length, "resource")}`);
  if (drift.removed.length) churn.push(`-${plural(drift.removed.length, "resource")}`);
  if (drift.changed.length) churn.push(`~${plural(drift.changed.length, "resource")} changed`);
  if (churn.length === 0) lines.push("No resource changes");
  else lines.push(churn.join(", "));

  // --- cost movement ---
  const deltaLabel =
    cost.delta === 0
      ? "no change"
      : `${cost.delta > 0 ? "+" : "-"}${formatMonthly(Math.abs(cost.delta))}`;
  lines.push(`Cost ${formatMonthly(cost.before)} -> ${formatMonthly(cost.after)} (${deltaLabel})`);
  if (cost.beforeUnknown || cost.afterUnknown) {
    lines.push(`Unpriced resources: ${cost.beforeUnknown} -> ${cost.afterUnknown}`);
  }

  // --- findings movement ---
  if (findings.resolved.length || findings.introduced.length) {
    lines.push(
      `${plural(findings.resolved.length, "finding")} resolved, ` +
        `${findings.introduced.length} introduced`,
    );
  } else {
    lines.push("No change in findings");
  }

  return lines;
}

/**
 * Render the receipt as a stable Markdown document.
 *
 * Pure formatting of {@link changeReceipt}'s output — deterministic and
 * timestamp-free so two renders of the same receipt are identical.
 */
export function renderMarkdown(receipt: ChangeReceipt): string {
  const { drift, cost, findings } = receipt;
  const out: string[] = [];

  out.push("# Change Receipt", "");

  out.push("## Summary", "");
  for (const line of receipt.summaryLines) out.push(`- ${line}`);
  out.push("");

  out.push("## Resources", "");
  out.push(renderRefList("Added", drift.added.map(refLabel)));
  out.push(renderRefList("Removed", drift.removed.map(refLabel)));
  out.push(
    renderRefList(
      "Changed",
      drift.changed.map((c) => `${refLabel(c)} (${plural(c.changes.length, "field")})`),
    ),
  );
  out.push("");

  out.push("## Cost", "");
  out.push(`- Before: ${formatMonthly(cost.before)} (${cost.beforeUnknown} unpriced)`);
  out.push(`- After: ${formatMonthly(cost.after)} (${cost.afterUnknown} unpriced)`);
  const deltaLabel =
    cost.delta === 0
      ? "no change"
      : `${cost.delta > 0 ? "+" : "-"}${formatMonthly(Math.abs(cost.delta))}`;
  out.push(`- Delta: ${deltaLabel}`);
  out.push("");

  out.push("## Findings", "");
  out.push(renderRefList("Resolved", findings.resolved));
  out.push(renderRefList("Introduced", findings.introduced));
  out.push(`- Unchanged: ${findings.unchanged}`);
  out.push("");

  return out.join("\n");
}

/** A drift ref's display label — `name (serviceId)`. */
function refLabel(r: { name: string; serviceId: string }): string {
  return `${r.name} (${r.serviceId})`;
}

/** Render a titled bullet sub-list, or a "none" marker when empty. */
function renderRefList(title: string, items: readonly string[]): string {
  if (items.length === 0) return `- ${title}: none`;
  const lines = [`- ${title}:`];
  for (const item of items) lines.push(`  - ${item}`);
  return lines.join("\n");
}
