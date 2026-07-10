import { describe, it, expect } from "vitest";
import { buildCostReport, renderGraphSvg } from "./offline";
import { emptyGraph, type InfrastructureGraph, type ResourceInstance } from "../aws/model";

function res(
  over: Partial<ResourceInstance> & { id: string; serviceId: string },
): ResourceInstance {
  return { name: over.id, config: {}, source: "imported", ...over };
}

function graph(
  resources: ResourceInstance[],
  relationships: InfrastructureGraph["relationships"] = [],
): InfrastructureGraph {
  const g = emptyGraph("test");
  g.resources = resources;
  g.relationships = relationships;
  return g;
}

describe("buildCostReport", () => {
  it("totals cost, rolls up by category, and flags a floor for unmapped billables", () => {
    const report = buildCostReport(
      graph([
        res({ id: "n", serviceId: "nat-gateway" }), // 32, networking
        res({ id: "db", serviceId: "rds" }), // ~62.3 with default storage, database
        res({ id: "k", serviceId: "kendra" }), // billable but unpriced -> floor
        res({ id: "role", serviceId: "iam-role" }), // known-free -> unknown, not a gap
      ]),
    );
    expect(report.resourceCount).toBe(4);
    expect(report.estimated).toBe(2);
    expect(report.unknown).toBe(2);
    expect(report.isFloor).toBe(true);
    expect(report.unmappedBillableTypes).toEqual(["kendra"]);
    // Categories present and sorted by spend (database's rds > networking's nat).
    const cats = report.categories.map((c) => c.category);
    expect(cats).toContain("database");
    expect(cats).toContain("networking");
    expect(report.categories[0].total).toBeGreaterThanOrEqual(report.categories[1].total);
  });

  it("reports no floor for a fully-priced + known-free graph", () => {
    const report = buildCostReport(
      graph([
        res({ id: "n", serviceId: "nat-gateway" }),
        res({ id: "role", serviceId: "iam-role" }),
      ]),
    );
    expect(report.isFloor).toBe(false);
    expect(report.unmappedBillableTypes).toEqual([]);
    expect(report.total).toBe(32);
  });
});

describe("renderGraphSvg", () => {
  it("produces a standalone SVG with the expected nodes", () => {
    const svg = renderGraphSvg(
      graph(
        [
          res({ id: "vpc", serviceId: "vpc", name: "Prod VPC" }),
          res({ id: "web", serviceId: "ec2-instance", name: "Web", parentId: "vpc" }),
        ],
        [{ id: "e", from: "web", to: "vpc", kind: "depends_on", source: "imported" }],
      ),
    );
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("</svg>");
    // Both node labels are rendered.
    expect(svg).toContain("Prod VPC");
    expect(svg).toContain("Web");
  });

  it("returns an empty string for an empty graph", () => {
    expect(renderGraphSvg(graph([]))).toBe("");
  });
});
