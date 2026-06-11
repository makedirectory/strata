/**
 * Explain & Clean — account review.
 * ----------------------------------
 * Composes the existing pure engines (cost, rules, model, registry) into a
 * single, honest "what's in this account and what should I clean up" report:
 *
 *   - a cost map summary (total / estimated / unknown) straight from `cost.ts`,
 *   - a scored findings list that carries `rules.ts` validation results through
 *     verbatim (no message-string parsing for logic — messages are display text
 *     only) and layers Strata's own info-level hygiene/cost observations on top,
 *   - a tag-coverage figure (fraction of resources carrying ≥1 non-empty tag),
 *   - orphan/unconnected detection (zero relationships AND no parent AND no
 *     children), and
 *   - a SAFE-CLEANUP checklist: unconnected, low/zero-cost, non-container
 *     resources that are candidates for deletion.
 *
 * Pure and side-effect-free: no DOM, network, or credentials. Output is fully
 * deterministic (stable sort everywhere) so the report is reproducible and
 * diff-friendly. Nothing is silently dropped — unknown-cost resources are
 * counted, never hidden, mirroring the "honest report" shape used by iac/drift.
 */
import type { InfrastructureGraph, ResourceInstance } from "./model";
import { relationshipsOf, childrenOf } from "./model";
import { estimateMonthlyCost, estimateTotal } from "./cost";
import { validateArchitecture } from "./rules";
import { getService, requireService } from "./registry";
import { detectFixes, type Fixable, type FixKind } from "./autofix";

/** A single scored observation about the account. */
export interface ReviewFinding {
  /** Stable, deterministic id (`<category>:<level>:<resourceId|graph>:<n>`). */
  id: string;
  level: "error" | "warn" | "info";
  category: "security" | "cost" | "hygiene" | "connectivity";
  message: string;
  resourceId?: string;
  /** Risk weight contributed to `AccountReview.riskScore` (error=3, warn=1, info=0). */
  score: number;
  /**
   * The id of an autofix (`detectFixes`) that resolves this finding, when one
   * exists — lets the UI offer a one-click "Fix". Absent when nothing mechanical
   * applies. See `linkFixes` for the (test-locked) finding↔fix correspondence.
   */
  fixId?: string;
}

/**
 * Distinctive, stable substrings of the `rules.ts` finding that each
 * config-flag fix resolves, keyed by the flag's config key (parsed from the
 * `secure-config-flag:<key>:<id>` fix id). The `review.test.ts` "fix links"
 * suite triggers each condition end-to-end and asserts the link holds, so a
 * wording drift in `rules.ts` fails CI rather than silently dropping a Fix
 * button. (Deliberately matched here in the display-aggregation layer, never in
 * the autofix engine, which stays decoupled from rule wording.)
 */
const SECURE_FLAG_KEYWORD: Readonly<Record<string, string>> = {
  blockPublicAccess: "Block Public Access disabled",
  publiclyAccessible: "must not be publicly accessible",
  uniformBucketLevelAccess: "uniform bucket-level access disabled",
  allowPublicAccess: "public blob access enabled",
  enableNonSslPort: "non-SSL port enabled",
};

/** Whether `fix` is the mechanical resolution of finding `f`. */
function fixResolvesFinding(fix: Fixable, f: ReviewFinding): boolean {
  const sameResource = f.resourceId === fix.resourceId;
  const kind: FixKind = fix.kind;
  switch (kind) {
    case "close-open-sg":
      return sameResource && f.message.includes("exposes sensitive port");
    case "enable-storage-encryption":
      return sameResource && f.message.includes("stores data at rest unencrypted");
    case "move-nat-to-public-subnet":
      return sameResource && f.message.includes("should be placed in a public Subnet");
    case "add-nat-per-az":
      return sameResource && f.message.includes("serves private subnets across");
    case "add-igw-default-route":
      // The fix is anchored to the route table, but the rules finding is on the
      // public subnet (different resourceId) — match on the message alone.
      return f.message.includes("routes to an Internet Gateway");
    case "secure-config-flag": {
      if (!sameResource) return false;
      const key = fix.id.split(":")[1];
      const kw = SECURE_FLAG_KEYWORD[key];
      return !!kw && f.message.includes(kw);
    }
    default: {
      // Exhaustiveness: a new FixKind must decide here whether it maps to a
      // finding (compile error until it does).
      const _never: never = kind;
      void _never;
      return false;
    }
  }
}

/**
 * Attach `fixId` to each finding that an autofix resolves. Each fix is assigned
 * to at most one finding (consumed on first match, in finding order), so two
 * findings never claim the same fix.
 */
function linkFixes(findings: ReviewFinding[], fixables: readonly Fixable[]): void {
  const used = new Set<number>();
  for (const f of findings) {
    for (let i = 0; i < fixables.length; i++) {
      if (used.has(i)) continue;
      if (fixResolvesFinding(fixables[i], f)) {
        f.fixId = fixables[i].id;
        used.add(i);
        break;
      }
    }
  }
}

/** A resource the review suggests is safe to delete. */
export interface CleanupCandidate {
  resourceId: string;
  serviceId: string;
  name: string;
  /** Estimated monthly USD reclaimed (0 when free or unknown). */
  monthlyCost: number;
  reason: string;
}

/** The full account review report. */
export interface AccountReview {
  resourceCount: number;
  /** Sum of estimable monthly USD (unknowns excluded — see `unknownCount`). */
  estimatedMonthly: number;
  /** How many resources had a cost estimate. */
  estimatedCount: number;
  /** How many resources had NO cost estimate (carried, never hidden). */
  unknownCount: number;
  tagCoverage: { tagged: number; untagged: number; coverage: number };
  orphanIds: string[];
  findings: ReviewFinding[];
  /** Deterministic sum of per-finding scores (sortable, stable). */
  riskScore: number;
  cleanup: CleanupCandidate[];
}

/** Numeric risk weight per level. info findings inform but don't raise risk. */
const LEVEL_SCORE: Record<ReviewFinding["level"], number> = {
  error: 3,
  warn: 1,
  info: 0,
};

/** True when a resource carries at least one non-empty tag value. */
function hasTag(r: ResourceInstance): boolean {
  if (!r.tags) return false;
  return Object.values(r.tags).some((v) => typeof v === "string" && v.trim() !== "");
}

/**
 * A resource is "unconnected" when it has no relationships in either direction,
 * no `parentId`, and no children. Such a node sits alone on the canvas — a
 * hygiene signal and the precondition for safe-cleanup eligibility.
 */
function isUnconnected(graph: InfrastructureGraph, r: ResourceInstance): boolean {
  if (r.parentId) return false;
  if (relationshipsOf(graph, r.id).length > 0) return false;
  if (childrenOf(graph, r.id).length > 0) return false;
  return true;
}

/**
 * Coerce a missing estimate (`null`) to 0 so cleanup candidates remain sortable
 * by reclaimable spend. This is a numeric convenience ONLY: a null estimate means
 * the cost is UNKNOWN, never that the resource is free — callers must distinguish
 * the two (see the cleanup reason text) and the headline cost map still reports
 * unpriced resources under `unknownCount` (never hidden).
 */
function monthlyOrZero(r: ResourceInstance): number {
  const c = estimateMonthlyCost(r);
  return c === null ? 0 : c;
}

/** A container service (VPC/subnet/…) is structural — never a cleanup candidate. */
function isContainer(serviceId: string): boolean {
  return getService(serviceId)?.isContainer === true;
}

/**
 * Run the account review. Pure: reads only the passed graph, returns a fresh
 * report object, mutates nothing.
 */
export function reviewAccount(graph: InfrastructureGraph): AccountReview {
  const resources = graph.resources;

  // ---- cost map (verbatim from cost.ts) ----
  const cost = estimateTotal(resources);

  // ---- tag coverage ----
  let tagged = 0;
  for (const r of resources) if (hasTag(r)) tagged++;
  const untagged = resources.length - tagged;
  const coverage = resources.length === 0 ? 0 : tagged / resources.length;

  // ---- orphan / unconnected detection ----
  const orphanIds = resources
    .filter((r) => isUnconnected(graph, r))
    .map((r) => r.id)
    .sort();
  const orphanSet = new Set(orphanIds);

  // ---- findings ----
  // 1. Carry rules.ts validation results through verbatim. `validateArchitecture`
  //    returns level "ok" entries too — those are not findings, so drop them.
  //    Map error->error, warn->warn; keep the message text exactly as display.
  const findings: ReviewFinding[] = [];
  for (const v of validateArchitecture(graph)) {
    if (v.level === "ok") continue;
    const category = v.level === "error" ? "security" : "hygiene";
    findings.push({
      id: "", // assigned deterministically after sort
      level: v.level,
      category,
      message: v.message,
      resourceId: v.resourceId,
      score: LEVEL_SCORE[v.level],
    });
  }

  // 2. Strata's own info-level hygiene/cost observations.
  if (resources.length > 0 && untagged > 0) {
    findings.push({
      id: "",
      level: "info",
      category: "hygiene",
      message: `${untagged} of ${resources.length} resources are untagged (${Math.round(
        coverage * 100,
      )}% tag coverage).`,
      score: LEVEL_SCORE.info,
    });
  }
  for (const id of orphanIds) {
    const r = resources.find((x) => x.id === id);
    if (!r) continue;
    findings.push({
      id: "",
      level: "info",
      category: "connectivity",
      message: `${r.name} is unconnected (no relationships, parent, or children).`,
      resourceId: r.id,
      score: LEVEL_SCORE.info,
    });
  }
  if (cost.unknown > 0) {
    findings.push({
      id: "",
      level: "info",
      category: "cost",
      message: `${cost.unknown} resource(s) have no cost estimate and are excluded from the $${Math.round(
        cost.total,
      )}/mo total.`,
      score: LEVEL_SCORE.info,
    });
  }

  // Deterministic ordering: level (error < warn < info), then resourceId, then
  // category, then message — so two findings on the same node still order stably.
  const levelRank: Record<ReviewFinding["level"], number> = { error: 0, warn: 1, info: 2 };
  findings.sort((a, b) => {
    if (levelRank[a.level] !== levelRank[b.level]) return levelRank[a.level] - levelRank[b.level];
    const ra = a.resourceId ?? "";
    const rb = b.resourceId ?? "";
    if (ra !== rb) return ra < rb ? -1 : 1;
    if (a.category !== b.category) return a.category < b.category ? -1 : 1;
    return a.message < b.message ? -1 : a.message > b.message ? 1 : 0;
  });
  // Assign stable ids now that order is fixed.
  findings.forEach((f, i) => {
    f.id = `${f.category}:${f.level}:${f.resourceId ?? "graph"}:${i}`;
  });

  // Offer a one-click fix on findings an autofix resolves.
  linkFixes(findings, detectFixes(graph));

  const riskScore = findings.reduce((sum, f) => sum + f.score, 0);

  // ---- safe-cleanup checklist ----
  // Unconnected AND non-container AND low/zero recurring cost. Containers are
  // structural; deleting them would orphan children, so they're never offered.
  const cleanup: CleanupCandidate[] = [];
  for (const id of orphanIds) {
    const r = resources.find((x) => x.id === id);
    if (!r) continue;
    if (isContainer(r.serviceId)) continue;
    const monthlyCost = monthlyOrZero(r);
    const name = getService(r.serviceId) ? requireService(r.serviceId).name : r.serviceId;
    // Three honest cases. A null estimate means UNKNOWN, not free — never imply
    // it's safe/free to delete (the module header promises unknown != free). We
    // keep `monthlyCost` numeric (0 for unknown), but the reason must say so.
    const costUnknown = estimateMonthlyCost(r) === null;
    const reason = costUnknown
      ? `Unconnected ${name} (recurring cost unknown — verify before deleting).`
      : monthlyCost > 0
        ? `Unconnected ${name}; deleting reclaims ~$${Math.round(monthlyCost)}/mo.`
        : `Unconnected ${name} with no recurring cost.`;
    cleanup.push({
      resourceId: r.id,
      serviceId: r.serviceId,
      name: r.name,
      monthlyCost,
      reason,
    });
  }
  // Highest reclaimable spend first, then by id for stability.
  cleanup.sort((a, b) => {
    if (a.monthlyCost !== b.monthlyCost) return b.monthlyCost - a.monthlyCost;
    return a.resourceId < b.resourceId ? -1 : a.resourceId > b.resourceId ? 1 : 0;
  });

  return {
    resourceCount: resources.length,
    estimatedMonthly: cost.total,
    estimatedCount: cost.estimated,
    unknownCount: cost.unknown,
    tagCoverage: { tagged, untagged, coverage },
    orphanIds,
    findings,
    riskScore,
    cleanup,
  };
}
