import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useFlowStore } from "./useFlowStore";

/** Render the store and return a helper to read the latest value. */
function setup() {
  const { result } = renderHook(() => useFlowStore());
  const ids = () => result.current.resources.map((r) => r.id);
  const find = (id: string) => result.current.resources.find((r) => r.id === id);
  return { result, ids, find };
}

describe("useFlowStore — reparent / group move / multi-delete (one undo step each)", () => {
  it("setParent reparents a node and undo reverts it in a single step", () => {
    const { result, find } = setup();
    act(() => result.current.addResource("vpc", 0, 0));
    const vpc = result.current.resources[0].id;
    act(() => result.current.addResource("lambda", 300, 0));
    const ec2 = result.current.resources[1].id;

    act(() => result.current.setParent(ec2, vpc));
    expect(find(ec2)!.parentId).toBe(vpc);

    act(() => result.current.undo());
    expect(find(ec2)!.parentId).toBeUndefined();
    expect(result.current.resources).toHaveLength(2); // only the reparent was undone
  });

  it("a group move (updatePositions + commit) is one undo step that reverts every node", () => {
    const { result, find } = setup();
    act(() => result.current.addResource("lambda", 0, 0));
    act(() => result.current.addResource("lambda", 400, 0));
    const [a, b] = result.current.resources.map((r) => r.id);
    const aStart = find(a)!.position!.x;
    const bStart = find(b)!.position!.x;

    act(() => {
      result.current.updateResourcePositions([
        { id: a, x: 1000, y: 1000 },
        { id: b, x: 1060, y: 1000 },
      ]);
      result.current.commitCurrentState();
    });
    expect(find(a)!.position!.x).toBe(1000);
    expect(find(b)!.position!.x).toBe(1060);

    act(() => result.current.undo());
    expect(find(a)!.position!.x).toBe(aStart);
    expect(find(b)!.position!.x).toBe(bStart);
  });

  it("multi-delete removes every selected node + incident edges in one undo step", () => {
    const { result } = setup();
    act(() => result.current.addResource("lambda", 0, 0));
    act(() => result.current.addResource("lambda", 400, 0));
    const [a, b] = result.current.resources.map((r) => r.id);
    act(() => result.current.connect(a, b, "connects_to"));
    expect(result.current.relationships).toHaveLength(1);

    act(() => result.current.setSelectedIds([a, b]));
    act(() => result.current.removeSelection());
    expect(result.current.resources).toHaveLength(0);
    expect(result.current.relationships).toHaveLength(0);

    act(() => result.current.undo());
    expect(result.current.resources).toHaveLength(2);
    expect(result.current.relationships).toHaveLength(1);
  });
});

describe("useFlowStore — dirty tracking (the unsaved-work flag the guard reads)", () => {
  it("starts clean and becomes dirty on the first committed edit", () => {
    const { result } = setup();
    expect(result.current.dirty).toBe(false);
    act(() => result.current.addResource("lambda", 0, 0));
    expect(result.current.dirty).toBe(true);
  });

  it("markSaved clears the flag and a later edit re-dirties it", () => {
    const { result } = setup();
    act(() => result.current.addResource("lambda", 0, 0));
    expect(result.current.dirty).toBe(true);

    act(() => result.current.markSaved());
    expect(result.current.dirty).toBe(false);

    act(() => result.current.addResource("s3-bucket", 200, 0));
    expect(result.current.dirty).toBe(true);
  });

  it("replaceAll (import / preset / server load) marks unsaved work", () => {
    const { result } = setup();
    act(() => result.current.markSaved()); // clean baseline
    expect(result.current.dirty).toBe(false);

    act(() =>
      result.current.replaceAll({
        resources: [{ id: "r1", serviceId: "lambda", name: "fn", config: {}, source: "imported" }],
        relationships: [],
      }),
    );
    expect(result.current.dirty).toBe(true);
  });

  it("clear is treated as unsaved work (it mutates the model)", () => {
    const { result } = setup();
    act(() => result.current.addResource("lambda", 0, 0));
    act(() => result.current.markSaved());
    expect(result.current.dirty).toBe(false);

    act(() => result.current.clear());
    expect(result.current.dirty).toBe(true);
  });

  it("undo/redo restores do not flip the flag (only committed changes do)", () => {
    const { result } = setup();
    act(() => result.current.addResource("lambda", 0, 0));
    act(() => result.current.markSaved());
    expect(result.current.dirty).toBe(false);

    // Restores go through the isRestoring guard, which bypasses `record`, so
    // the dirty flag is intentionally left untouched by undo/redo.
    act(() => result.current.undo());
    expect(result.current.dirty).toBe(false);
    act(() => result.current.redo());
    expect(result.current.dirty).toBe(false);
  });
});

describe("useFlowStore — annotation layer (create / load / undo)", () => {
  it("addAnnotation lands in state and undo reverts it in one step", () => {
    const { result } = setup();
    act(() => result.current.addAnnotation({ id: "a1", kind: "note", text: "hi", x: 10, y: 20 }));
    expect(result.current.annotations).toHaveLength(1);
    expect(result.current.annotations[0]).toMatchObject({ id: "a1", text: "hi" });

    act(() => result.current.undo());
    expect(result.current.annotations).toHaveLength(0);
  });

  it("updateAnnotation patches x/y and removeAnnotation deletes by id", () => {
    const { result } = setup();
    act(() =>
      result.current.addAnnotation({
        id: "a1",
        kind: "zone",
        text: "Z",
        x: 0,
        y: 0,
        w: 100,
        h: 80,
      }),
    );
    act(() => result.current.updateAnnotation("a1", { x: 50, y: 60 }));
    expect(result.current.annotations[0]).toMatchObject({ x: 50, y: 60, w: 100, h: 80 });

    act(() => result.current.removeAnnotation("a1"));
    expect(result.current.annotations).toHaveLength(0);
  });

  it("replaceAll (load) PRESERVES annotations passed in the loaded graph", () => {
    const { result } = setup();
    act(() =>
      result.current.replaceAll({
        resources: [{ id: "r1", serviceId: "lambda", name: "fn", config: {}, source: "imported" }],
        relationships: [],
        annotations: [{ id: "a1", kind: "note", text: "loaded note", x: 5, y: 5 }],
        graphId: "g1",
        graphName: "Loaded",
      }),
    );
    expect(result.current.annotations).toHaveLength(1);
    expect(result.current.annotations[0]).toMatchObject({ id: "a1", text: "loaded note" });
  });

  it("replaceAll without an annotations field clears the layer (explicit default)", () => {
    const { result } = setup();
    act(() => result.current.addAnnotation({ id: "a1", kind: "note", text: "x", x: 0, y: 0 }));
    expect(result.current.annotations).toHaveLength(1);
    act(() => result.current.replaceAll({ resources: [], relationships: [] }));
    expect(result.current.annotations).toHaveLength(0);
  });
});

describe("useFlowStore — diagram name", () => {
  it("defaults to a placeholder, renames, and resets on clear", () => {
    const { result } = setup();
    expect(result.current.graphName).toBe("Untitled diagram");

    act(() => result.current.setGraphName("My Architecture"));
    expect(result.current.graphName).toBe("My Architecture");
    expect(result.current.dirty).toBe(true);

    act(() => result.current.clear());
    expect(result.current.graphName).toBe("Untitled diagram");
    expect(result.current.graphId).toBe("");
  });

  it("replaceAll applies the loaded graph's name; updateResourceSize sets w/h", () => {
    const { result } = setup();
    act(() =>
      result.current.replaceAll({
        resources: [],
        relationships: [],
        graphId: "g1",
        graphName: "Loaded Graph",
      }),
    );
    expect(result.current.graphName).toBe("Loaded Graph");

    act(() => result.current.addResource("vpc", 0, 0));
    const id = result.current.resources[0].id;
    act(() => result.current.updateResourceSize(id, { w: 480, h: 320 }));
    const pos = result.current.resources[0].position!;
    expect(pos.w).toBe(480);
    expect(pos.h).toBe(320);
  });
});
