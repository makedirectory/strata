import { describe, it, expect } from "vitest";
import { arrangeTiered } from "./arrange";
import type { ResourceInstance, Relationship } from "../aws/model";

let seq = 0;
function res(id: string, over: Partial<ResourceInstance> = {}): ResourceInstance {
  return {
    id,
    serviceId: over.serviceId ?? "ec2",
    name: id,
    config: {},
    source: "manual",
    position: { x: 0, y: 0, w: 240, h: 100 },
    ...over,
  };
}
function rel(from: string, to: string): Relationship {
  return { id: `${from}->${to}-${seq++}`, from, to, kind: "connects_to" };
}

// VPC/subnet are containers (matches the registry's isContainer flag for these).
const isContainer = (r: ResourceInstance) =>
  r.serviceId.startsWith("vpc") || r.serviceId.startsWith("subnet");

describe("arrangeTiered", () => {
  it("returns nothing for an empty graph", () => {
    expect(arrangeTiered([], [], isContainer)).toEqual([]);
  });

  it("layers a chain left-to-right by dependency flow (increasing x per tier)", () => {
    const a = res("a");
    const b = res("b");
    const c = res("c");
    const out = arrangeTiered([a, b, c], [rel("a", "b"), rel("b", "c")], isContainer);
    const x = new Map(out.map((p) => [p.id, p.x]));
    expect(x.get("a")!).toBeLessThan(x.get("b")!);
    expect(x.get("b")!).toBeLessThan(x.get("c")!);
  });

  it("stacks same-tier nodes in a column (shared x, distinct y)", () => {
    // a → b and a → c: b and c share tier 1.
    const out = arrangeTiered(
      [res("a"), res("b"), res("c")],
      [rel("a", "b"), rel("a", "c")],
      isContainer,
    );
    const by = new Map(out.map((p) => [p.id, p]));
    expect(by.get("b")!.x).toBe(by.get("c")!.x);
    expect(by.get("b")!.y).not.toBe(by.get("c")!.y);
  });

  it("only positions top-level roots; children are layout-owned (omitted)", () => {
    const vpc = res("vpc", { serviceId: "vpc" });
    const subnet = res("sn", { serviceId: "subnet-private", parentId: "vpc" });
    const ec2 = res("ec2", { parentId: "sn" });
    const out = arrangeTiered([vpc, subnet, ec2], [], isContainer);
    expect(out.map((p) => p.id)).toEqual(["vpc"]);
  });

  it("attributes a child's edge to its root when tiering", () => {
    // ec2 (inside vpc) → db (a separate root). The edge should push db one tier
    // to the right of the vpc root, not crash on the nested endpoint.
    const vpc = res("vpc", { serviceId: "vpc" });
    const ec2 = res("ec2", { parentId: "vpc" });
    const db = res("db", { serviceId: "rds" });
    const out = arrangeTiered([vpc, ec2, db], [rel("ec2", "db")], isContainer);
    const x = new Map(out.map((p) => [p.id, p.x]));
    expect(out.map((p) => p.id).sort()).toEqual(["db", "vpc"]);
    expect(x.get("vpc")!).toBeLessThan(x.get("db")!);
  });

  it("does not loop forever on a cycle", () => {
    const out = arrangeTiered(
      [res("a"), res("b"), res("c")],
      [rel("a", "b"), rel("b", "c"), rel("c", "a")],
      isContainer,
    );
    expect(out).toHaveLength(3);
  });

  it("keeps the acyclic part in dependency order despite a back-edge", () => {
    // a → b → c → d with a back-edge d → b. b/c/d are NOT in a true cycle from
    // the flow's perspective except via the back-edge; breaking it must keep
    // a < b < c < d left-to-right rather than collapsing c,d to tier 0.
    const out = arrangeTiered(
      [res("a"), res("b"), res("c"), res("d")],
      [rel("a", "b"), rel("b", "c"), rel("c", "d"), rel("d", "b")],
      isContainer,
    );
    const x = new Map(out.map((p) => [p.id, p.x]));
    expect(x.get("a")!).toBeLessThan(x.get("b")!);
    expect(x.get("b")!).toBeLessThan(x.get("c")!);
    expect(x.get("c")!).toBeLessThan(x.get("d")!);
  });

  it("grid-packs disconnected roots below the layered block", () => {
    // a→b are layered at the top; x,y,z are isolated and packed below them.
    const out = arrangeTiered(
      [res("a"), res("b"), res("x"), res("y"), res("z")],
      [rel("a", "b")],
      isContainer,
    );
    const by = new Map(out.map((p) => [p.id, p]));
    const layeredBottom = Math.max(by.get("a")!.y + 100, by.get("b")!.y + 100);
    for (const id of ["x", "y", "z"]) {
      expect(by.get(id)!.y).toBeGreaterThanOrEqual(layeredBottom);
    }
  });

  it("snaps positions to the grid", () => {
    const out = arrangeTiered([res("a"), res("b")], [rel("a", "b")], isContainer);
    for (const p of out) {
      expect(p.x % 16).toBe(0);
      expect(p.y % 16).toBe(0);
    }
  });
});
