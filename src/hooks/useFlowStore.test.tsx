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
