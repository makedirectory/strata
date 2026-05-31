// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import { randomUUID } from "crypto";
import type { InfrastructureGraph } from "../aws/model";
import { SCHEMA_VERSION } from "../aws/model";
import type { FileRepository as FileRepositoryType } from "./fileRepository";

let dataDir: string;
let repo: FileRepositoryType;

/**
 * `DATA_DIR` in fileRepository.ts is resolved at module-import time, so we set
 * AWS_FLOW_DATA_DIR to a fresh unique temp dir, reset the module registry, and
 * dynamically import a fresh FileRepository before each test.
 */
beforeEach(async () => {
  dataDir = path.join(os.tmpdir(), `aws-flow-test-${randomUUID()}`);
  process.env.AWS_FLOW_DATA_DIR = dataDir;
  vi.resetModules();
  const mod = await import("./fileRepository");
  repo = new mod.FileRepository();
});

afterEach(async () => {
  await fs.rm(dataDir, { recursive: true, force: true });
  delete process.env.AWS_FLOW_DATA_DIR;
});

/** A graph payload as a caller would submit it (pre-persist). */
/** Write a graph record straight to disk, bypassing the repository's stamping. */
async function writeRaw(graph: InfrastructureGraph): Promise<void> {
  await fs.writeFile(
    path.join(dataDir, `${graph.id}.json`),
    JSON.stringify(graph, null, 2),
    "utf8",
  );
}

function makeGraph(overrides: Partial<InfrastructureGraph> = {}): InfrastructureGraph {
  return {
    id: "",
    name: "Test Graph",
    accounts: [{ id: "acc-1", accountId: "123456789012", name: "prod" }],
    resources: [
      { id: "r-1", serviceId: "ec2-instance", name: "web", config: {}, source: "manual" },
      { id: "r-2", serviceId: "rds", name: "db", config: {}, source: "manual" },
    ],
    relationships: [],
    schemaVersion: 0,
    ...overrides,
  };
}

describe("FileRepository.create", () => {
  it("assigns a UUID id, schemaVersion, and matching timestamps", async () => {
    const created = await repo.create(makeGraph());

    expect(created.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(created.schemaVersion).toBe(SCHEMA_VERSION);
    expect(created.createdAt).toBeTruthy();
    expect(created.updatedAt).toBe(created.createdAt);
    // ISO 8601 timestamp.
    expect(new Date(created.createdAt!).toISOString()).toBe(created.createdAt);
  });

  it("ignores any caller-supplied id and schemaVersion", async () => {
    const created = await repo.create(makeGraph({ id: "caller-id", schemaVersion: 999 }));
    expect(created.id).not.toBe("caller-id");
    expect(created.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it("preserves the caller's domain data", async () => {
    const created = await repo.create(makeGraph({ name: "My Env" }));
    expect(created.name).toBe("My Env");
    expect(created.resources).toHaveLength(2);
    expect(created.accounts).toHaveLength(1);
  });

  it("writes a JSON file named <id>.json on disk", async () => {
    const created = await repo.create(makeGraph());
    const file = path.join(dataDir, `${created.id}.json`);
    const raw = await fs.readFile(file, "utf8");
    expect(JSON.parse(raw)).toMatchObject({ id: created.id, name: "Test Graph" });
  });
});

describe("FileRepository.get", () => {
  it("returns a previously created graph", async () => {
    const created = await repo.create(makeGraph());
    const fetched = await repo.get(created.id);
    expect(fetched).toEqual(created);
  });

  it("returns null for a missing (but well-formed) id", async () => {
    expect(await repo.get(randomUUID())).toBeNull();
  });
});

describe("FileRepository.list", () => {
  it("returns an empty array when nothing is stored", async () => {
    expect(await repo.list()).toEqual([]);
  });

  it("returns summaries with id, name, resourceCount, updatedAt", async () => {
    const created = await repo.create(makeGraph({ name: "Solo" }));
    const list = await repo.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toEqual({
      id: created.id,
      name: "Solo",
      description: created.description,
      resourceCount: 2,
      updatedAt: created.updatedAt,
    });
  });

  it("sorts summaries by updatedAt descending (newest first)", async () => {
    // create()/update() stamp updatedAt with the current time, which would make
    // three quick writes effectively tie. Write the files directly with known,
    // distinct updatedAt values so the ordering assertion is deterministic.
    const a = await repo.create(makeGraph({ name: "A" }));
    const b = await repo.create(makeGraph({ name: "B" }));
    const c = await repo.create(makeGraph({ name: "C" }));

    await writeRaw({ ...a, updatedAt: "2020-01-01T00:00:00.000Z" });
    await writeRaw({ ...b, updatedAt: "2022-01-01T00:00:00.000Z" });
    await writeRaw({ ...c, updatedAt: "2021-01-01T00:00:00.000Z" });

    const ids = (await repo.list()).map((s) => s.id);
    expect(ids).toEqual([b.id, c.id, a.id]);
  });
});

describe("FileRepository.update", () => {
  it("replaces fields, preserves createdAt, and bumps updatedAt", async () => {
    const created = await repo.create(makeGraph({ name: "Before" }));

    const updated = await repo.update(created.id, {
      ...created,
      name: "After",
      resources: [],
    });

    expect(updated).not.toBeNull();
    expect(updated!.id).toBe(created.id);
    expect(updated!.name).toBe("After");
    expect(updated!.resources).toEqual([]);
    expect(updated!.createdAt).toBe(created.createdAt);
    expect(updated!.schemaVersion).toBe(SCHEMA_VERSION);
    // updatedAt is refreshed to now (>= the original).
    expect(new Date(updated!.updatedAt!).getTime()).toBeGreaterThanOrEqual(
      new Date(created.updatedAt!).getTime(),
    );
  });

  it("persists the update so a subsequent get reflects it", async () => {
    const created = await repo.create(makeGraph({ name: "Before" }));
    await repo.update(created.id, { ...created, name: "After" });
    const fetched = await repo.get(created.id);
    expect(fetched!.name).toBe("After");
  });

  it("ignores caller-supplied id, forcing the path id", async () => {
    const created = await repo.create(makeGraph());
    const updated = await repo.update(created.id, { ...created, id: "spoofed" });
    expect(updated!.id).toBe(created.id);
  });

  it("returns null when updating a missing id", async () => {
    const result = await repo.update(randomUUID(), makeGraph());
    expect(result).toBeNull();
  });
});

describe("FileRepository.remove", () => {
  it("removes an existing graph and returns true; get then returns null", async () => {
    const created = await repo.create(makeGraph());
    expect(await repo.remove(created.id)).toBe(true);
    expect(await repo.get(created.id)).toBeNull();
  });

  it("returns false when removing a missing id", async () => {
    expect(await repo.remove(randomUUID())).toBe(false);
  });
});

describe("FileRepository path-traversal / id validation", () => {
  // Ids are server-generated UUIDs; anything else must fail loudly rather than
  // resolve to a file outside DATA_DIR. The id guard is the only thing standing
  // between a request path segment and the filesystem, so it is tested directly.
  const badIds = [
    "../../etc/passwd",
    "..%2F..%2Fetc%2Fpasswd",
    "a/b",
    "..",
    "",
    "not-a-uuid",
    "../" + "x".repeat(8) + "-0000-0000-0000-000000000000",
  ];

  it("returns null/false for malformed ids instead of touching other paths", async () => {
    for (const id of badIds) {
      expect(await repo.get(id)).toBeNull();
      expect(await repo.update(id, makeGraph())).toBeNull();
      expect(await repo.remove(id)).toBe(false);
    }
  });

  it("never writes a file outside the data dir for a traversal id", async () => {
    await repo.update("../escaped", makeGraph()).catch(() => null);
    // Only the data dir exists; the traversal target must not have been created.
    const escaped = path.join(dataDir, "..", "escaped.json");
    await expect(fs.readFile(escaped, "utf8")).rejects.toBeTruthy();
  });
});

describe("FileRepository atomic writes", () => {
  it("leaves no temp files behind after create/update", async () => {
    const created = await repo.create(makeGraph());
    await repo.update(created.id, { ...created, name: "v2" });
    const files = await fs.readdir(dataDir);
    expect(files).toEqual([`${created.id}.json`]);
    expect(files.some((f) => f.endsWith(".tmp"))).toBe(false);
  });
});
