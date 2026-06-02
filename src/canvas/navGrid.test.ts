import { describe, it, expect } from "vitest";
import { nextInDirection, readingOrder, type NavRect } from "./navGrid";

// A simple 2x2 grid of 100x60 nodes at (0,0)/(200,0)/(0,150)/(200,150).
const GRID: NavRect[] = [
  { id: "tl", x: 0, y: 0, w: 100, h: 60 },
  { id: "tr", x: 200, y: 0, w: 100, h: 60 },
  { id: "bl", x: 0, y: 150, w: 100, h: 60 },
  { id: "br", x: 200, y: 150, w: 100, h: 60 },
];

describe("nextInDirection", () => {
  it("moves right/left along a row", () => {
    expect(nextInDirection(GRID, "tl", "right")).toBe("tr");
    expect(nextInDirection(GRID, "tr", "left")).toBe("tl");
  });

  it("moves down/up along a column", () => {
    expect(nextInDirection(GRID, "tl", "down")).toBe("bl");
    expect(nextInDirection(GRID, "bl", "up")).toBe("tl");
  });

  it("returns null at an edge with nothing in that direction", () => {
    expect(nextInDirection(GRID, "tl", "up")).toBeNull();
    expect(nextInDirection(GRID, "tl", "left")).toBeNull();
  });

  it("prefers the node most directly in line over a closer diagonal one", () => {
    const rects: NavRect[] = [
      { id: "from", x: 0, y: 0, w: 100, h: 60 },
      { id: "diag", x: 120, y: 120, w: 100, h: 60 }, // closer by raw distance
      { id: "right", x: 220, y: 5, w: 100, h: 60 }, // more directly to the right
    ];
    expect(nextInDirection(rects, "from", "right")).toBe("right");
  });

  it("returns null when the node isn't present", () => {
    expect(nextInDirection(GRID, "missing", "right")).toBeNull();
  });
});

describe("readingOrder", () => {
  it("orders top-to-bottom then left-to-right", () => {
    expect(readingOrder(GRID)).toEqual(["tl", "tr", "bl", "br"]);
  });

  it("treats near-aligned rows as one row within tolerance", () => {
    const rects: NavRect[] = [
      { id: "b", x: 200, y: 8, w: 100, h: 60 }, // slightly lower but same row
      { id: "a", x: 0, y: 0, w: 100, h: 60 },
    ];
    expect(readingOrder(rects, 24)).toEqual(["a", "b"]);
  });
});
