import { describe, it, expect } from "vitest";
import { rectCenter, edgeAnchor, fitLabel, arrowhead } from "./drawPrimitives";

describe("rectCenter", () => {
  it("returns the centre point", () => {
    expect(rectCenter({ x: 10, y: 20, w: 40, h: 60 })).toEqual({ x: 30, y: 50 });
  });
});

describe("edgeAnchor", () => {
  it("returns the border point toward an external point (right edge)", () => {
    // Square centred at (50,50); a point to the right exits at the right edge.
    const r = { x: 40, y: 40, w: 20, h: 20 };
    const p = edgeAnchor(r, { x: 200, y: 50 });
    expect(p.x).toBeCloseTo(60); // right edge
    expect(p.y).toBeCloseTo(50);
  });

  it("returns the centre for a degenerate rect", () => {
    const r = { x: 0, y: 0, w: 0, h: 0 };
    expect(edgeAnchor(r, { x: 100, y: 0 })).toEqual({ x: 0, y: 0 });
  });
});

describe("fitLabel", () => {
  it("passes short labels through unchanged", () => {
    expect(fitLabel("web", 400)).toBe("web");
  });

  it("truncates long labels with an ellipsis to fit the width", () => {
    const out = fitLabel("a-very-long-resource-name-that-will-not-fit", 80);
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBeLessThan("a-very-long-resource-name-that-will-not-fit".length);
  });
});

describe("arrowhead", () => {
  it("builds a triangle whose tip is the endpoint", () => {
    const head = arrowhead({ x: 0, y: 0 }, { x: 10, y: 0 }, 8, 4);
    expect(head.tip).toEqual({ x: 10, y: 0 });
    // Base corners sit behind the tip along the arrival direction, spread apart.
    expect(head.left.x).toBeCloseTo(2);
    expect(head.right.x).toBeCloseTo(2);
    expect(Math.abs(head.left.y - head.right.y)).toBeCloseTo(8); // 2 × spread
  });
});
