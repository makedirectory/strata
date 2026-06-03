import { describe, it, expect, beforeEach } from "vitest";
import { listSnapshots, saveSnapshot, getSnapshot, deleteSnapshot } from "./snapshots";
import { emptyGraph, type InfrastructureGraph } from "../aws/model";

function graph(name: string, n: number): InfrastructureGraph {
  return {
    ...emptyGraph(name),
    resources: Array.from({ length: n }, (_, i) => ({
      id: `r${i}`,
      serviceId: "vpc",
      name: `r${i}`,
      config: {},
      source: "manual" as const,
    })),
  };
}

describe("snapshots ring", () => {
  beforeEach(() => window.localStorage.clear());

  it("saves and lists newest-first with metadata", () => {
    saveSnapshot(graph("Alpha", 2), "first");
    saveSnapshot(graph("Beta", 3), "second");
    const list = listSnapshots();
    expect(list.map((s) => s.label)).toEqual(["second", "first"]);
    expect(list[0].resourceCount).toBe(3);
    expect(list[0].name).toBe("Beta");
  });

  it("falls back to the diagram name when no label is given", () => {
    saveSnapshot(graph("MyDiagram", 1), "   ");
    expect(listSnapshots()[0].label).toBe("MyDiagram");
  });

  it("round-trips the full graph and deep-clones it (later edits don't mutate the snapshot)", () => {
    const g = graph("X", 1);
    const meta = saveSnapshot(g, "v1");
    g.resources.push({
      id: "extra",
      serviceId: "s3-bucket",
      name: "extra",
      config: {},
      source: "manual",
    });
    const restored = getSnapshot(meta.id);
    expect(restored?.resources).toHaveLength(1); // snapshot unaffected by the post-save push
  });

  it("caps the ring at 25, dropping the oldest", () => {
    for (let i = 0; i < 30; i++) saveSnapshot(graph(`G${i}`, 1), `v${i}`);
    const list = listSnapshots();
    expect(list).toHaveLength(25);
    expect(list[0].label).toBe("v29"); // newest kept
    expect(list.some((s) => s.label === "v4")).toBe(false); // oldest dropped
  });

  it("deletes by id", () => {
    const a = saveSnapshot(graph("A", 1), "a");
    saveSnapshot(graph("B", 1), "b");
    deleteSnapshot(a.id);
    expect(listSnapshots().map((s) => s.label)).toEqual(["b"]);
    expect(getSnapshot(a.id)).toBeNull();
  });
});
