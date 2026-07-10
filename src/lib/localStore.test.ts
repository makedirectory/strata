import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { listGraphs, getGraph, createGraph } from "./localStore";
import type { InfrastructureGraph } from "../aws/model";

const STORAGE_KEY = "strata:graphs:v1";

function valid(id: string, name: string): InfrastructureGraph {
  return {
    id,
    name,
    accounts: [],
    resources: [],
    relationships: [],
    schemaVersion: 1,
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("localStore readAll hardening", () => {
  beforeEach(() => window.localStorage.clear());

  it("drops corrupt records so listGraphs only returns valid ones", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        good: valid("good", "Good"),
        missingArrays: { id: "missingArrays", name: "Broken", schemaVersion: 1 },
        notAnObject: 42,
        nullRecord: null,
      }),
    );
    const list = await listGraphs();
    expect(list.map((g) => g.id)).toEqual(["good"]);
  });

  it("treats a malformed record as not found rather than crashing", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ broken: { id: "broken", name: "X" } }), // no resources/relationships arrays
    );
    await expect(getGraph("broken")).rejects.toThrow();
  });

  it("returns valid graphs untouched", async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ a: valid("a", "Alpha") }));
    const g = await getGraph("a");
    expect(g.name).toBe("Alpha");
    expect(g.resources).toEqual([]);
  });

  it("tolerates non-object / unparseable storage as empty", async () => {
    window.localStorage.setItem(STORAGE_KEY, "not json");
    expect(await listGraphs()).toEqual([]);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([1, 2, 3]));
    expect(await listGraphs()).toEqual([]);
  });
});

describe("localStore durable desktop bridge", () => {
  const w = window as unknown as { strataDesktop?: unknown };
  beforeEach(() => window.localStorage.clear());
  afterEach(() => delete w.strataDesktop);

  it("reads/writes through window.strataDesktop.storage instead of localStorage", async () => {
    let file: string | null = null;
    w.strataDesktop = {
      storage: {
        read: () => file,
        write: (json: string) => {
          file = json;
        },
      },
    };
    const g = await createGraph(valid("ignored", "Desktop graph"));
    // Persisted to the bridge, NOT to localStorage.
    expect(file).toContain("Desktop graph");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    // And reads come back from the bridge.
    expect((await listGraphs()).some((s) => s.name === "Desktop graph")).toBe(true);
    expect((await getGraph(g.id)).name).toBe("Desktop graph");
  });
});
