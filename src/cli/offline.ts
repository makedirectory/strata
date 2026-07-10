/**
 * Offline CLI one-shots — pure helpers behind `strata cost` and `strata render`.
 * ----------------------------------------------------------------------------
 * Kept separate from `bin.ts` (which owns argv/stdout/file I/O) so the analysis
 * is pure and unit-testable: `buildCostReport` and `renderGraphSvg` take a graph
 * and return data/text with no side effects. They wrap the same engines the app
 * and MCP server use (cost.ts, computeLayout, buildSvg) and read all visual
 * metadata from the registry, honoring the "everything derives from the
 * registry" invariant.
 */
import type { InfrastructureGraph } from "../aws/model";
import { estimateMonthlyCost, estimateTotal, type CostAssumptions } from "../aws/cost";
import { getService, serviceColor, serviceIcon } from "../aws/registry";
import { computeLayout } from "../canvas/layout";
import { buildSvg } from "../canvas/imageExport";

/** One category's estimated spend + how many resources contributed. */
export interface CategoryRollup {
  category: string;
  total: number;
  count: number;
}

/** The full offline cost report (`strata cost`). */
export interface CostReport {
  resourceCount: number;
  /** Sum of estimable monthly USD (unpriced excluded). */
  total: number;
  estimated: number;
  unknown: number;
  /** True when a billable type is unmapped — `total` is a lower bound. */
  isFloor: boolean;
  unmappedBillableTypes: string[];
  /** Per-category roll-up, highest spend first. */
  categories: CategoryRollup[];
}

/** Roll a graph up into a cost report: total, per-category, and floor honesty. */
export function buildCostReport(
  graph: InfrastructureGraph,
  assumptions?: CostAssumptions,
): CostReport {
  const totals = estimateTotal(graph.resources, assumptions);
  const byCategory = new Map<string, { total: number; count: number }>();
  for (const r of graph.resources) {
    const c = estimateMonthlyCost(r, assumptions);
    if (c === null) continue;
    const category = getService(r.serviceId)?.category ?? "other";
    const agg = byCategory.get(category) ?? { total: 0, count: 0 };
    agg.total += c;
    agg.count++;
    byCategory.set(category, agg);
  }
  const categories = [...byCategory.entries()]
    .map(([category, v]) => ({ category, total: v.total, count: v.count }))
    .sort((a, b) => b.total - a.total || (a.category < b.category ? -1 : 1));
  return {
    resourceCount: graph.resources.length,
    total: totals.total,
    estimated: totals.estimated,
    unknown: totals.unknown,
    isFloor: totals.isFloor,
    unmappedBillableTypes: totals.unmappedBillableTypes,
    categories,
  };
}

/**
 * Render a saved graph to a standalone SVG string (the headless equivalent of
 * the in-app image export). Runs `computeLayout` and feeds `buildSvg` with
 * registry-derived colour/icon/label/container metadata.
 */
export function renderGraphSvg(graph: InfrastructureGraph): string {
  const resources = graph.resources ?? [];
  const layout = computeLayout(resources, {
    isContainer: (r) => !!getService(r.serviceId)?.isContainer,
  });
  return buildSvg({
    resources,
    edges: (graph.relationships ?? []).map((e) => ({ from: e.from, to: e.to })),
    rects: layout.rects,
    color: (id) => serviceColor(id),
    icon: (id) => serviceIcon(id),
    label: (r) => r.name,
    isContainer: (id) => layout.isContainerNode(id),
  });
}
