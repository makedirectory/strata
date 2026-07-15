/**
 * Resource inventory & bill-of-materials — pure reporting engine.
 * ---------------------------------------------------------------
 * Turns an `InfrastructureGraph` into the flat, tabular exports people ask for
 * under many names — **Cloud Asset Inventory**, **Resource Export/Dump**,
 * **Resource Manifest**, **Configuration Baseline** — which are all the same
 * thing: one row per resource with its type, placement, tags, config and rough
 * cost. {@link resourceInventory} produces that; {@link billOfMaterials} is the
 * rollup (counts + cost per service type). {@link toCsv} serialises either.
 *
 * Pure and deterministic (stable sort), so exports diff cleanly and can be run
 * from the UI or headless. Cost comes from the same `cost.ts` engine (a rough
 * us-east-1 figure; `null` = unpriced).
 */
import type { InfrastructureGraph, ResourceInstance } from "./model";
import { getService, serviceProvider } from "./registry";
import { estimateMonthlyCost } from "./cost";

/** One resource, flattened for an inventory/manifest/asset export. */
export interface InventoryRow {
  id: string;
  name: string;
  serviceId: string;
  service: string;
  category: string;
  provider: string;
  /** Provider-native type (CloudFormation/ARM/CAI), the cross-tool join key. */
  nativeType: string;
  accountId: string;
  region: string;
  parentId: string;
  /** Tags flattened as "k=v; k2=v2" (sorted). */
  tags: string;
  /** Rough monthly USD, or null when unpriced (kept distinct from 0/free). */
  monthlyCost: number | null;
}

const flattenTags = (tags: Record<string, string> | undefined): string =>
  tags
    ? Object.entries(tags)
        .filter(([, v]) => typeof v === "string" && v.trim() !== "")
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => `${k}=${v}`)
        .join("; ")
    : "";

/** One row per resource, sorted by id for a stable, diff-friendly export. */
export function resourceInventory(graph: InfrastructureGraph): InventoryRow[] {
  return graph.resources
    .map((r: ResourceInstance): InventoryRow => {
      const svc = getService(r.serviceId);
      return {
        id: r.id,
        name: r.name,
        serviceId: r.serviceId,
        service: svc?.fullName ?? svc?.name ?? r.serviceId,
        category: svc?.category ?? "unknown",
        provider: svc ? serviceProvider(svc) : "aws",
        nativeType: svc?.nativeType ?? svc?.cfnType ?? "",
        accountId: r.accountId ?? "",
        region: r.region ?? "",
        parentId: r.parentId ?? "",
        tags: flattenTags(r.tags),
        monthlyCost: estimateMonthlyCost(r),
      };
    })
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** One row per distinct service type: how many, and their total rough cost. */
export interface BomRow {
  serviceId: string;
  service: string;
  category: string;
  count: number;
  /** Sum of priced instances (unpriced contribute 0 but are counted below). */
  monthlyCost: number;
  /** How many of `count` had no price (so `monthlyCost` is a floor). */
  unpriced: number;
}

export interface BillOfMaterials {
  rows: BomRow[];
  totalResources: number;
  totalMonthly: number;
  /** Distinct service types with at least one unpriced resource. */
  unpricedResources: number;
}

/** Roll the inventory up by service type (a bill of materials). */
export function billOfMaterials(graph: InfrastructureGraph): BillOfMaterials {
  const by = new Map<string, BomRow>();
  let totalMonthly = 0;
  let unpricedResources = 0;
  for (const r of graph.resources) {
    const svc = getService(r.serviceId);
    let row = by.get(r.serviceId);
    if (!row) {
      row = {
        serviceId: r.serviceId,
        service: svc?.fullName ?? svc?.name ?? r.serviceId,
        category: svc?.category ?? "unknown",
        count: 0,
        monthlyCost: 0,
        unpriced: 0,
      };
      by.set(r.serviceId, row);
    }
    row.count++;
    const c = estimateMonthlyCost(r);
    if (c === null) {
      row.unpriced++;
      unpricedResources++;
    } else {
      row.monthlyCost += c;
      totalMonthly += c;
    }
  }
  // Highest spend first, then most numerous, then id for stability.
  const rows = [...by.values()].sort(
    (a, b) =>
      b.monthlyCost - a.monthlyCost ||
      b.count - a.count ||
      (a.serviceId < b.serviceId ? -1 : a.serviceId > b.serviceId ? 1 : 0),
  );
  return { rows, totalResources: graph.resources.length, totalMonthly, unpricedResources };
}

/** Escape one CSV field (RFC 4180: quote when it contains , " or newline). */
function csvField(v: string | number | null): string {
  if (v === null) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Serialise a header + rows into a CSV string (CRLF line endings, RFC 4180). */
export function toCsv(
  headers: readonly string[],
  rows: ReadonlyArray<ReadonlyArray<string | number | null>>,
): string {
  const lines = [headers.map(csvField).join(",")];
  for (const row of rows) lines.push(row.map(csvField).join(","));
  return lines.join("\r\n");
}

/** The inventory as a CSV string (column order fixed for stable exports). */
export function inventoryCsv(graph: InfrastructureGraph): string {
  const headers = [
    "id",
    "name",
    "serviceId",
    "service",
    "category",
    "provider",
    "nativeType",
    "accountId",
    "region",
    "parentId",
    "tags",
    "monthlyCostUSD",
  ];
  const rows = resourceInventory(graph).map((r) => [
    r.id,
    r.name,
    r.serviceId,
    r.service,
    r.category,
    r.provider,
    r.nativeType,
    r.accountId,
    r.region,
    r.parentId,
    r.tags,
    r.monthlyCost,
  ]);
  return toCsv(headers, rows);
}

/** The bill of materials as a CSV string (with a TOTAL row). */
export function bomCsv(graph: InfrastructureGraph): string {
  const bom = billOfMaterials(graph);
  const headers = ["serviceId", "service", "category", "count", "unpriced", "monthlyCostUSD"];
  const rows: (string | number | null)[][] = bom.rows.map((r) => [
    r.serviceId,
    r.service,
    r.category,
    r.count,
    r.unpriced,
    Math.round(r.monthlyCost),
  ]);
  rows.push([
    "TOTAL",
    "",
    "",
    bom.totalResources,
    bom.unpricedResources,
    Math.round(bom.totalMonthly),
  ]);
  return toCsv(headers, rows);
}
