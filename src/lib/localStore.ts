/**
 * Browser-local persistence for saved diagrams.
 *
 * The hosted app runs on a read-only serverless filesystem (Vercel), so graphs
 * can't be persisted server-side without a real datastore. Instead each browser
 * keeps its own diagrams in `localStorage`; JSON export/import (see `lib/api` is
 * unrelated — that's the IaC/discovery client) remains the way to move a diagram
 * between browsers or share it.
 *
 * The function surface mirrors the old server client so the hook layer only has
 * to swap its import. All functions are async to keep that call-site contract,
 * even though `localStorage` is synchronous.
 *
 * Note: the server-backed `Repository` + `/api/graphs` route are intentionally
 * left in place for a future durable backend (Postgres/DynamoDB); the hosted UI
 * simply no longer depends on them.
 */
import type { InfrastructureGraph, GraphSummary } from "../aws/model";
import { SCHEMA_VERSION, summarize } from "../aws/model";

/** Versioned key so a future schema migration can detect/convert old payloads. */
const STORAGE_KEY = "strata:graphs:v1";

/** Read the whole id→graph map, tolerating absent/corrupt storage as empty. */
function readAll(): Record<string, InfrastructureGraph> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, InfrastructureGraph>)
      : {};
  } catch {
    return {};
  }
}

/** Persist the whole map, surfacing a quota overflow as a friendly error. */
function writeAll(map: Record<string, InfrastructureGraph>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch (err) {
    if (err instanceof DOMException && /quota/i.test(err.name)) {
      throw new Error("Browser storage is full — delete a saved diagram or export to JSON.");
    }
    throw err;
  }
}

/** GET-equivalent: list saved-graph summaries, newest first. */
export async function listGraphs(): Promise<GraphSummary[]> {
  return Object.values(readAll())
    .map(summarize)
    .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
}

/** Fetch a full graph by id, throwing if it isn't in this browser's store. */
export async function getGraph(id: string): Promise<InfrastructureGraph> {
  const g = readAll()[id];
  if (!g) throw new Error("That diagram isn't saved in this browser.");
  return g;
}

/** Create a new saved graph with a generated id and timestamps. */
export async function createGraph(graph: InfrastructureGraph): Promise<InfrastructureGraph> {
  const now = new Date().toISOString();
  const record: InfrastructureGraph = {
    ...graph,
    id: crypto.randomUUID(),
    schemaVersion: SCHEMA_VERSION,
    createdAt: now,
    updatedAt: now,
  };
  const map = readAll();
  map[record.id] = record;
  writeAll(map);
  return record;
}

/** Replace an existing graph (preserving its createdAt), bumping updatedAt. */
export async function updateGraph(
  id: string,
  graph: InfrastructureGraph,
): Promise<InfrastructureGraph> {
  const map = readAll();
  const now = new Date().toISOString();
  const record: InfrastructureGraph = {
    ...graph,
    id,
    schemaVersion: SCHEMA_VERSION,
    createdAt: map[id]?.createdAt ?? now,
    updatedAt: now,
  };
  map[id] = record;
  writeAll(map);
  return record;
}

/** Remove a saved graph (no-op if it's already gone). */
export async function deleteGraph(id: string): Promise<void> {
  const map = readAll();
  if (id in map) {
    delete map[id];
    writeAll(map);
  }
}
