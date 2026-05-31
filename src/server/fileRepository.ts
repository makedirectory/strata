/**
 * File-backed Repository implementation.
 * Stores each graph as a JSON document under `.data/graphs/<id>.json`.
 * Runs with zero external infrastructure — ideal for local dev and demos,
 * and a faithful stand-in for a real document/row store.
 */
import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import type { Repository } from "./repository";
import type { InfrastructureGraph, GraphSummary } from "../aws/model";
import { SCHEMA_VERSION, summarize } from "../aws/model";
import { isInfrastructureGraph } from "./graphSchema";

const DATA_DIR = process.env.AWS_FLOW_DATA_DIR
  ? path.resolve(process.env.AWS_FLOW_DATA_DIR)
  : path.join(process.cwd(), ".data", "graphs");

/** Stored ids are `randomUUID()` output — accept exactly that v4 UUID shape. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function ensureDir(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

/**
 * Persist a graph atomically: serialise to a temp file in the same directory,
 * then `rename` over the target. `rename(2)` is atomic on POSIX, so readers
 * never observe a half-written file and a crash mid-write cannot corrupt an
 * existing graph (the previous version stays intact, the temp file is orphaned).
 * Note: this prevents torn writes, not lost updates — concurrent writers are
 * still last-write-wins by design for this file store.
 */
async function writeGraphFile(id: string, record: InfrastructureGraph): Promise<void> {
  const target = fileFor(id);
  const tmp = path.join(DATA_DIR, `.${id}.${randomUUID()}.tmp`);
  await fs.writeFile(tmp, JSON.stringify(record, null, 2), "utf8");
  try {
    await fs.rename(tmp, target);
  } catch (err) {
    await fs.unlink(tmp).catch(() => {});
    throw err;
  }
}

/**
 * Resolve the on-disk path for an id. Ids are server-generated UUIDs; we
 * validate rather than sanitize so a malformed id fails loudly instead of
 * being silently mangled into a colliding filename (e.g. `a-b`/`a_b`). This
 * also closes off path traversal.
 */
function fileFor(id: string): string {
  if (!UUID_RE.test(id)) {
    throw new Error(`Invalid graph id: ${id}`);
  }
  return path.join(DATA_DIR, `${id}.json`);
}

/**
 * Read and parse a stored graph. Returns null when the file is absent.
 * Logs and returns null when the file exists but is corrupt or fails the
 * structural check, so integrity problems are surfaced rather than hidden.
 */
async function readGraph(id: string): Promise<InfrastructureGraph | null> {
  let raw: string;
  try {
    raw = await fs.readFile(fileFor(id), "utf8");
  } catch {
    // Missing file (or unreadable id) — treat as "not found".
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isInfrastructureGraph(parsed)) {
      console.warn(`[FileRepository] Stored graph ${id} failed schema validation; ignoring.`);
      return null;
    }
    return parsed;
  } catch (err) {
    console.warn(`[FileRepository] Failed to parse stored graph ${id}:`, err);
    return null;
  }
}

export class FileRepository implements Repository {
  async list(): Promise<GraphSummary[]> {
    await ensureDir();
    const files = (await fs.readdir(DATA_DIR)).filter((f) => f.endsWith(".json"));
    const graphs = await Promise.all(
      files.map(async (f) => {
        try {
          const parsed: unknown = JSON.parse(await fs.readFile(path.join(DATA_DIR, f), "utf8"));
          if (!isInfrastructureGraph(parsed)) {
            console.warn(`[FileRepository] Skipping ${f}: failed schema validation.`);
            return null;
          }
          return parsed;
        } catch (err) {
          console.warn(`[FileRepository] Skipping ${f}: failed to read/parse:`, err);
          return null;
        }
      }),
    );
    return graphs
      .filter((g): g is InfrastructureGraph => g !== null)
      .map(summarize)
      .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  }

  async get(id: string): Promise<InfrastructureGraph | null> {
    await ensureDir();
    return readGraph(id);
  }

  async create(graph: InfrastructureGraph): Promise<InfrastructureGraph> {
    await ensureDir();
    const now = new Date().toISOString();
    const record: InfrastructureGraph = {
      ...graph,
      id: randomUUID(),
      schemaVersion: SCHEMA_VERSION,
      createdAt: now,
      updatedAt: now,
    };
    await writeGraphFile(record.id, record);
    return record;
  }

  async update(id: string, graph: InfrastructureGraph): Promise<InfrastructureGraph | null> {
    await ensureDir();
    const existing = await readGraph(id);
    if (!existing) return null;
    const record: InfrastructureGraph = {
      ...graph,
      id,
      schemaVersion: SCHEMA_VERSION,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    };
    await writeGraphFile(id, record);
    return record;
  }

  async remove(id: string): Promise<boolean> {
    try {
      await fs.unlink(fileFor(id));
      return true;
    } catch {
      return false;
    }
  }
}
