import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useCanvasInteraction } from "./useCanvasInteraction";
import type { ResourceInstance } from "../aws/model";
import type { Rect } from "../canvas/geometry";

const node: ResourceInstance = {
  id: "a",
  serviceId: "ec2",
  name: "a",
  config: {},
  source: "manual",
  position: { x: 0, y: 0, w: 240, h: 100 },
};
const rects = new Map<string, Rect>([["a", { x: 0, y: 0, w: 240, h: 100 }]]);
const pan = { x: 0, y: 0, scale: 1 };

function mouseEvent(over: Record<string, unknown> = {}) {
  return {
    preventDefault: () => {},
    stopPropagation: () => {},
    clientX: 0,
    clientY: 0,
    button: 0,
    currentTarget: null,
    ...over,
  } as unknown as React.MouseEvent & MouseEvent;
}

describe("useCanvasInteraction — presentation / read-only gating", () => {
  it("read-only: a node press selects but never starts a drag", () => {
    const { result } = renderHook(() => useCanvasInteraction());
    const selectSingle = vi.fn();
    const updatePositions = vi.fn();
    const setOverride = vi.fn();

    result.current.onNodeMouseDown(mouseEvent(), node, {
      pan,
      mode: "move",
      resources: [node],
      selectedIds: [],
      rects,
      readOnly: true,
      connect: vi.fn(),
      selectSingle,
    });
    expect(selectSingle).toHaveBeenCalledWith("a");

    // A subsequent move must move nothing, because no drag was armed.
    result.current.onMouseMove(mouseEvent({ clientX: 80, clientY: 60 }), {
      rects,
      pan,
      getPan: () => pan,
      updatePositions,
      updateSize: vi.fn(),
      updatePan: vi.fn(),
      setGuides: vi.fn(),
      setMarquee: vi.fn(),
      setOverride,
    });
    expect(updatePositions).not.toHaveBeenCalled();
    expect(setOverride).not.toHaveBeenCalled();
  });

  it("editable: a node press arms a drag, so a move updates the position", () => {
    const { result } = renderHook(() => useCanvasInteraction());
    const updatePositions = vi.fn();

    result.current.onNodeMouseDown(mouseEvent(), node, {
      pan,
      mode: "move",
      resources: [node],
      selectedIds: [],
      rects,
      readOnly: false,
      connect: vi.fn(),
      selectSingle: vi.fn(),
    });
    result.current.onMouseMove(mouseEvent({ clientX: 80, clientY: 60 }), {
      rects,
      pan,
      getPan: () => pan,
      updatePositions,
      updateSize: vi.fn(),
      updatePan: vi.fn(),
      setGuides: vi.fn(),
      setMarquee: vi.fn(),
      setOverride: vi.fn(),
    });
    expect(updatePositions).toHaveBeenCalledTimes(1);
    expect(updatePositions.mock.calls[0][0][0].id).toBe("a");
  });
});

describe("useCanvasInteraction — resize", () => {
  it("resizes a node from its corner, flooring at the minimum and committing once", () => {
    const { result } = renderHook(() => useCanvasInteraction());
    const updateSize = vi.fn();
    const commitState = vi.fn();
    const selectSingle = vi.fn();

    // Grab the bottom-right corner at the node's far edge (240×100).
    result.current.onResizeStart(mouseEvent({ clientX: 240, clientY: 100 }), node, {
      rects,
      readOnly: false,
      selectSingle,
    });
    expect(selectSingle).toHaveBeenCalledWith("a");

    // Drag out by +120/+60 → 360×160.
    result.current.onMouseMove(mouseEvent({ clientX: 360, clientY: 160 }), {
      rects,
      pan,
      getPan: () => pan,
      updatePositions: vi.fn(),
      updateSize,
      updatePan: vi.fn(),
      setGuides: vi.fn(),
      setMarquee: vi.fn(),
      setOverride: vi.fn(),
    });
    expect(updateSize).toHaveBeenLastCalledWith("a", { w: 360, h: 160 });

    // Drag far past the top-left → clamps to the minimum (120×60).
    result.current.onMouseMove(mouseEvent({ clientX: -500, clientY: -500 }), {
      rects,
      pan,
      getPan: () => pan,
      updatePositions: vi.fn(),
      updateSize,
      updatePan: vi.fn(),
      setGuides: vi.fn(),
      setMarquee: vi.fn(),
      setOverride: vi.fn(),
    });
    expect(updateSize).toHaveBeenLastCalledWith("a", { w: 120, h: 60 });

    // Release commits a single history entry.
    result.current.onMouseUp({
      rects,
      commitState,
      selectSingle: vi.fn(),
      applyMarquee: vi.fn(),
      clearSelection: vi.fn(),
      setGuides: vi.fn(),
      setMarquee: vi.fn(),
      setOverride: vi.fn(),
      containerAt: () => null,
      setParent: vi.fn(),
    });
    expect(commitState).toHaveBeenCalledTimes(1);
  });

  it("read-only: a resize gesture is ignored", () => {
    const { result } = renderHook(() => useCanvasInteraction());
    const updateSize = vi.fn();
    result.current.onResizeStart(mouseEvent({ clientX: 240, clientY: 100 }), node, {
      rects,
      readOnly: true,
      selectSingle: vi.fn(),
    });
    result.current.onMouseMove(mouseEvent({ clientX: 360, clientY: 160 }), {
      rects,
      pan,
      getPan: () => pan,
      updatePositions: vi.fn(),
      updateSize,
      updatePan: vi.fn(),
      setGuides: vi.fn(),
      setMarquee: vi.fn(),
      setOverride: vi.fn(),
    });
    expect(updateSize).not.toHaveBeenCalled();
  });
});
