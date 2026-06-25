/**
 * File-based snapshot store (server-only, local deployments).
 * -----------------------------------------------------------
 * With no user accounts, saved diagrams live in a **dedicated storage folder**
 * outside the IaC project, so Strata's output never mixes with the user's repo
 * and the folder can be its own git repo for history. Configure it with
 * `STRATA_DATA_DIR` (default `~/.strata`).
 *
 * Disabled on hosted deployments: there the app stays **localStorage-only** and
 * these functions refuse, mirroring the rest of the local-only companion.
 */
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { InfrastructureGraph } from "../aws/model";
import type { PlanDiff } from "../aws/planDiff";
import { isHosted } from "./repoFs";

export interface SnapshotMeta {
  id: string;
  name: string;
  createdAt: string;
  /** Source repo path + root, when the snapshot came from the companion. */
  repo?: string;
  root?: string;
  /** Whether a plan diff is attached. */
  hasDiff: boolean;
  resourceCount: number;
}

export interface Snapshot extends SnapshotMeta {
  graph: InfrastructureGraph;
  diff?: PlanDiff;
}

/** Absolute path of the storage folder (`STRATA_DATA_DIR` or `~/.strata`). */
export function storeDir(): string {
  return process.env.STRATA_DATA_DIR || join(homedir(), ".strata");
}

function assertEnabled(): void {
  if (isHosted()) {
    throw new Error("Snapshot storage is disabled on hosted deployments (localStorage only).");
  }
}

/** Only allow our own generated ids through (defence against path traversal). */
function safeId(id: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error("Invalid snapshot id.");
  return id;
}

const fileFor = (id: string) => join(storeDir(), `${safeId(id)}.json`);

/** Persist a snapshot and return its metadata. */
export async function saveSnapshot(input: {
  name: string;
  graph: InfrastructureGraph;
  diff?: PlanDiff;
  repo?: string;
  root?: string;
}): Promise<SnapshotMeta> {
  assertEnabled();
  const meta: SnapshotMeta = {
    id: randomUUID(),
    name: input.name || "diagram",
    createdAt: new Date().toISOString(),
    repo: input.repo,
    root: input.root,
    hasDiff: !!input.diff,
    resourceCount: input.graph.resources.length,
  };
  const snapshot: Snapshot = { ...meta, graph: input.graph, diff: input.diff };
  await mkdir(storeDir(), { recursive: true });
  await writeFile(fileFor(meta.id), JSON.stringify(snapshot, null, 2), "utf8");
  return meta;
}

/** List saved snapshots (metadata only), newest first. */
export async function listSnapshots(): Promise<SnapshotMeta[]> {
  assertEnabled();
  let files: string[];
  try {
    files = (await readdir(storeDir())).filter((f) => f.endsWith(".json"));
  } catch {
    return []; // folder doesn't exist yet
  }
  const metas: SnapshotMeta[] = [];
  for (const f of files) {
    try {
      const s = JSON.parse(await readFile(join(storeDir(), f), "utf8")) as Snapshot;
      metas.push({
        id: s.id,
        name: s.name,
        createdAt: s.createdAt,
        repo: s.repo,
        root: s.root,
        hasDiff: !!s.diff,
        resourceCount: s.graph?.resources?.length ?? 0,
      });
    } catch {
      /* skip unreadable/garbage files */
    }
  }
  return metas.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Load one full snapshot by id. */
export async function loadSnapshot(id: string): Promise<Snapshot> {
  assertEnabled();
  const file = fileFor(id); // validates id (throws on traversal) before any read
  try {
    return JSON.parse(await readFile(file, "utf8")) as Snapshot;
  } catch {
    throw new Error(`Snapshot not found: ${id}`);
  }
}

/** Delete a snapshot by id. */
export async function deleteSnapshot(id: string): Promise<void> {
  assertEnabled();
  await rm(fileFor(id), { force: true });
}
