import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useHistory, type HistoryState } from "./useHistory";
import type { ResourceInstance } from "../aws/model";

function resource(id: string): ResourceInstance {
  return { id, serviceId: "ec2", name: id, config: {}, source: "manual" };
}
function state(resources: ResourceInstance[]): HistoryState {
  return {
    resources,
    relationships: [],
    viewport: { x: 0, y: 0, scale: 1 },
    accounts: [],
    graphId: "",
  };
}

describe("useHistory", () => {
  it("undo/redo return prior/next states", () => {
    const { result } = renderHook(() => useHistory<HistoryState>());
    const s1 = state([resource("a")]);
    const s2 = state([resource("a"), resource("b")]);
    act(() => result.current.commit(s1));
    act(() => result.current.commit(s2));

    expect(result.current.canUndo()).toBe(true);
    let undone: HistoryState | null = null;
    act(() => {
      undone = result.current.undo();
    });
    expect(undone!.resources.map((r) => r.id)).toEqual(["a"]);

    let redone: HistoryState | null = null;
    act(() => {
      redone = result.current.redo();
    });
    expect(redone!.resources.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("uses structural sharing — keeps the committed array + element refs (no deep clone)", () => {
    const { result } = renderHook(() => useHistory<HistoryState>());
    const s1 = state([resource("a")]);
    const s2 = state([resource("a"), resource("b")]);
    act(() => result.current.commit(s1));
    act(() => result.current.commit(s2));
    let undone: HistoryState | null = null;
    act(() => {
      undone = result.current.undo();
    });
    // Same array reference and same element object — proves no structuredClone.
    expect(undone!.resources).toBe(s1.resources);
    expect(undone!.resources[0]).toBe(s1.resources[0]);
  });
});
