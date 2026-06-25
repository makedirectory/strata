// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyGraph } from "../aws/model";
import { saveSnapshot, listSnapshots, loadSnapshot, deleteSnapshot, storeDir } from "./strataStore";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "strata-store-test-"));
  process.env.STRATA_DATA_DIR = dir;
  delete process.env.NEXT_PUBLIC_STRATA_HOSTED;
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  delete process.env.STRATA_DATA_DIR;
});

function graphWith(n: number) {
  const g = emptyGraph("test");
  g.resources = Array.from({ length: n }, (_, i) => ({
    id: `r${i}`,
    serviceId: "vpc",
    name: `r${i}`,
    source: "imported" as const,
    config: {},
    position: { x: 0, y: 0, w: 240, h: 100 },
  }));
  return g;
}

describe("strataStore", () => {
  it("honours STRATA_DATA_DIR", () => {
    expect(storeDir()).toBe(dir);
  });

  it("saves, lists, loads and deletes a snapshot", async () => {
    const meta = await saveSnapshot({
      name: "prod",
      graph: graphWith(3),
      repo: "/x",
      root: "prod",
    });
    expect(meta.resourceCount).toBe(3);

    const list = await listSnapshots();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("prod");

    const full = await loadSnapshot(meta.id);
    expect(full.graph.resources).toHaveLength(3);
    expect(full.root).toBe("prod");

    await deleteSnapshot(meta.id);
    expect(await listSnapshots()).toHaveLength(0);
  });

  it("attaches a plan diff when given one", async () => {
    const meta = await saveSnapshot({
      name: "p",
      graph: graphWith(1),
      diff: {
        changes: { r0: "create" },
        counts: { create: 1, update: 0, delete: 0, replace: 0, read: 0, noop: 0 },
      },
    });
    expect(meta.hasDiff).toBe(true);
    expect((await loadSnapshot(meta.id)).diff?.changes.r0).toBe("create");
  });

  it("rejects path-traversal ids", async () => {
    await expect(loadSnapshot("../etc/passwd")).rejects.toThrow(/Invalid snapshot id/);
  });

  it("refuses when hosted", async () => {
    process.env.NEXT_PUBLIC_STRATA_HOSTED = "1";
    await expect(saveSnapshot({ name: "x", graph: graphWith(1) })).rejects.toThrow(/hosted/);
    await expect(listSnapshots()).rejects.toThrow(/hosted/);
  });
});
