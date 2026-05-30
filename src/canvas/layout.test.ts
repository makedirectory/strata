import { describe, it, expect } from "vitest";
import {
  computeLayout,
  HEADER_H,
  PAD,
  COLLAPSED_H,
  COMPACT_LEAF_H,
  DEFAULT_LEAF_H,
} from "./layout";
import type { ResourceInstance } from "../aws/model";

function res(id: string, over: Partial<ResourceInstance> = {}, x = 0, y = 0): ResourceInstance {
  return {
    id,
    serviceId: over.serviceId ?? "ec2",
    name: id,
    config: {},
    source: "manual",
    position: { x, y, w: 240, h: 100 },
    ...over,
  };
}

// Treat anything whose serviceId starts with "vpc"/"subnet" as a container.
const isContainer = (r: ResourceInstance) =>
  r.serviceId.startsWith("vpc") || r.serviceId.startsWith("subnet");

describe("computeLayout", () => {
  it("places a top-level leaf at its stored position with leaf size", () => {
    const { rects, depth } = computeLayout([res("a", {}, 120, 80)], { isContainer });
    expect(rects.get("a")).toEqual({ x: 120, y: 80, w: 240, h: 100 });
    expect(depth.get("a")).toBe(0);
  });

  it("auto-fits a container around its packed children", () => {
    const vpc = res("vpc", { serviceId: "vpc" }, 50, 60);
    const c1 = res("c1", { parentId: "vpc" });
    const c2 = res("c2", { parentId: "vpc" });
    const { rects, depth, childCount, isContainerNode } = computeLayout([vpc, c1, c2], {
      isContainer,
    });
    const box = rects.get("vpc")!;
    expect(box.x).toBe(50);
    expect(box.y).toBe(60);
    // Container is taller than just its header (it contains children).
    expect(box.h).toBeGreaterThan(HEADER_H + PAD);
    // Children sit inside the content area (below the header, past the padding).
    const child = rects.get("c1")!;
    expect(child.x).toBeGreaterThanOrEqual(box.x + PAD);
    expect(child.y).toBeGreaterThanOrEqual(box.y + HEADER_H + PAD);
    expect(depth.get("c1")).toBe(1);
    expect(childCount("vpc")).toBe(2);
    expect(isContainerNode("vpc")).toBe(true);
    expect(isContainerNode("c1")).toBe(false);
  });

  it("nests recursively (VPC ▸ subnet ▸ instance) with increasing depth", () => {
    const vpc = res("vpc", { serviceId: "vpc" }, 0, 0);
    const sub = res("sub", { serviceId: "subnet-public", parentId: "vpc" });
    const ins = res("ins", { parentId: "sub" });
    const { rects, depth } = computeLayout([vpc, sub, ins], { isContainer });
    expect(depth.get("vpc")).toBe(0);
    expect(depth.get("sub")).toBe(1);
    expect(depth.get("ins")).toBe(2);
    // Instance is inside the subnet which is inside the VPC.
    const vb = rects.get("vpc")!;
    const sb = rects.get("sub")!;
    const ib = rects.get("ins")!;
    expect(sb.x).toBeGreaterThanOrEqual(vb.x);
    expect(ib.x).toBeGreaterThanOrEqual(sb.x);
    expect(vb.w).toBeGreaterThanOrEqual(sb.w);
  });

  it("hides descendants of a collapsed container and maps them to it", () => {
    const vpc = res("vpc", { serviceId: "vpc" }, 0, 0);
    const c1 = res("c1", { parentId: "vpc" });
    const { rects, visibleAncestor } = computeLayout([vpc, c1], {
      isContainer,
      collapsed: new Set(["vpc"]),
    });
    expect(rects.get("vpc")!.h).toBe(COLLAPSED_H);
    expect(rects.has("c1")).toBe(false);
    expect(visibleAncestor.get("c1")).toBe("vpc");
  });

  it("maps a deeply hidden node to the OUTERMOST collapsed ancestor", () => {
    const vpc = res("vpc", { serviceId: "vpc" }, 0, 0);
    const sub = res("sub", { serviceId: "subnet-public", parentId: "vpc" });
    const ins = res("ins", { parentId: "sub" });
    // Both vpc and sub collapsed → ins represented by the visible one (vpc).
    const { visibleAncestor, rects } = computeLayout([vpc, sub, ins], {
      isContainer,
      collapsed: new Set(["vpc", "sub"]),
    });
    expect(rects.has("sub")).toBe(false);
    expect(visibleAncestor.get("ins")).toBe("vpc");
    expect(visibleAncestor.get("sub")).toBe("vpc");
  });

  it("detaches the drag-override subtree to a free anchor and repacks the parent", () => {
    const vpc = res("vpc", { serviceId: "vpc" }, 0, 0);
    const c1 = res("c1", { parentId: "vpc" });
    const c2 = res("c2", { parentId: "vpc" });
    const withoutDrag = computeLayout([vpc, c1, c2], { isContainer });
    const dragging = computeLayout([vpc, c1, c2], {
      isContainer,
      override: { id: "c2", x: 900, y: 900 },
    });
    // The dragged node is anchored at the cursor, as a root.
    expect(dragging.rects.get("c2")).toEqual({ x: 900, y: 900, w: 240, h: 100 });
    expect(dragging.depth.get("c2")).toBe(0);
    // Its old parent shrinks now that it packs one fewer child.
    expect(dragging.rects.get("vpc")!.h).toBeLessThanOrEqual(withoutDrag.rects.get("vpc")!.h);
  });

  it("is cycle-safe: mutually-parented nodes become roots", () => {
    const a = res("a", { parentId: "b" }, 10, 10);
    const b = res("b", { parentId: "a" }, 20, 20);
    const { rects } = computeLayout([a, b], { isContainer });
    expect(rects.has("a")).toBe(true);
    expect(rects.has("b")).toBe(true);
  });

  it("uses the compact leaf height under Compact density", () => {
    const comfy = computeLayout([res("a")], { isContainer, density: "comfortable" });
    const compact = computeLayout([res("a")], { isContainer, density: "compact" });
    expect(comfy.rects.get("a")!.h).toBe(DEFAULT_LEAF_H);
    expect(compact.rects.get("a")!.h).toBe(COMPACT_LEAF_H);
  });
});
