import { describe, it, expect } from "vitest";
import { hitTest, rectContains, type HitNode } from "./hitTest";

const node = (id: string, x: number, y: number, w: number, h: number, depth: number): HitNode => ({
  id,
  rect: { x, y, w, h },
  depth,
});

describe("rectContains", () => {
  it("includes the interior and edges, excludes outside", () => {
    const r = { x: 0, y: 0, w: 10, h: 10 };
    expect(rectContains(r, 5, 5)).toBe(true);
    expect(rectContains(r, 0, 0)).toBe(true); // corner (inclusive)
    expect(rectContains(r, 10, 10)).toBe(true); // far corner (inclusive)
    expect(rectContains(r, 11, 5)).toBe(false);
    expect(rectContains(r, -1, 5)).toBe(false);
  });
});

describe("hitTest", () => {
  it("returns null when the point hits nothing", () => {
    expect(hitTest([node("a", 0, 0, 10, 10, 0)], 100, 100)).toBeNull();
  });

  it("picks the deepest node (child wins over its container)", () => {
    // A container (depth 0) with a child (depth 1) inside it; a point over the
    // child must select the child, not the container it sits in.
    const container = node("vpc", 0, 0, 100, 100, 0);
    const child = node("ec2", 20, 20, 40, 40, 1);
    expect(hitTest([container, child], 30, 30)).toBe("ec2");
    // A point inside the container but outside the child selects the container.
    expect(hitTest([container, child], 5, 5)).toBe("vpc");
  });

  it("breaks depth ties in favour of the later (on-top) node", () => {
    const a = node("a", 0, 0, 50, 50, 0);
    const b = node("b", 0, 0, 50, 50, 0); // same rect + depth, drawn after a
    expect(hitTest([a, b], 10, 10)).toBe("b");
  });
});
