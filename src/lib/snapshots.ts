/**
 * Local version history — a bounded ring of diagram snapshots in `localStorage`.
 *
 * This is the local-first half of "versioned diagram history": cheap, durable
 * within this browser, and immediately useful as drift/cost-diff baselines and
 * for restore. It is intentionally NOT cross-device — that needs the sharing
 * backend (a `versions` sub-resource on the `Repository`), which can promote
 * these later. See `specs/README.md`.
 *
 * A single global ring (newest first), capped at `MAX_SNAPSHOTS`; each record
 * carries the full graph plus a label, the diagram name, and a timestamp.
 */
import type { InfrastructureGraph } from "../aws/model";

const STORAGE_KEY = "strata:snapshots:v1";
const MAX_SNAPSHOTS = 25;

export interface SnapshotMeta {
  id: string;
  /** User label, e.g. "pre-migration" (falls back to the diagram name). */
  label: string;
  /** Diagram name at snapshot time. */
  name: string;
  createdAt: string;
  resourceCount: number;
}

interface SnapshotRecord extends SnapshotMeta {
  graph: InfrastructureGraph;
}

function isValid(v: unknown): v is SnapshotRecord {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    typeof r.createdAt === "string" &&
    !!r.graph &&
    typeof r.graph === "object" &&
    Array.isArray((r.graph as InfrastructureGraph).resources)
  );
}

function readAll(): SnapshotRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isValid) : [];
  } catch {
    return [];
  }
}

function writeAll(list: SnapshotRecord[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch (err) {
    if (err instanceof DOMException && /quota/i.test(err.name)) {
      throw new Error("Browser storage is full — delete some saved versions.");
    }
    throw err;
  }
}

const toMeta = (r: SnapshotRecord): SnapshotMeta => ({
  id: r.id,
  label: r.label,
  name: r.name,
  createdAt: r.createdAt,
  resourceCount: r.resourceCount,
});

/** All snapshots, newest first (metadata only). */
export function listSnapshots(): SnapshotMeta[] {
  return readAll().map(toMeta);
}

/**
 * Save a snapshot of `graph` and return its metadata. Prepended (newest first);
 * the ring is trimmed to `MAX_SNAPSHOTS`, dropping the oldest.
 */
export function saveSnapshot(graph: InfrastructureGraph, label: string): SnapshotMeta {
  const record: SnapshotRecord = {
    id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}`,
    label: label.trim() || graph.name || "Untitled",
    name: graph.name || "Untitled",
    createdAt: new Date().toISOString(),
    resourceCount: graph.resources.length,
    // Deep-clone so later canvas edits can't mutate the stored snapshot.
    graph: structuredClone(graph),
  };
  writeAll([record, ...readAll()].slice(0, MAX_SNAPSHOTS));
  return toMeta(record);
}

/** The full graph for a snapshot id, or null if it's gone. */
export function getSnapshot(id: string): InfrastructureGraph | null {
  return readAll().find((r) => r.id === id)?.graph ?? null;
}

/** Remove a snapshot (no-op if already gone). */
export function deleteSnapshot(id: string): void {
  writeAll(readAll().filter((r) => r.id !== id));
}
