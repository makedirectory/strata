import { describe, it, expect } from "vitest";
import { resourceInventory, billOfMaterials, toCsv, inventoryCsv, bomCsv } from "./inventory";
import { emptyGraph, type InfrastructureGraph, type ResourceInstance } from "./model";

function res(
  over: Partial<ResourceInstance> & { id: string; serviceId: string },
): ResourceInstance {
  return { name: over.id, config: {}, source: "imported", ...over };
}

function graph(resources: ResourceInstance[]): InfrastructureGraph {
  const g = emptyGraph("test");
  g.resources = resources;
  return g;
}

describe("resourceInventory", () => {
  it("flattens each resource with type, cost, and sorted tags, ordered by id", () => {
    const rows = resourceInventory(
      graph([
        res({ id: "b", serviceId: "nat-gateway", name: "nat", region: "us-east-1" }),
        res({
          id: "a",
          serviceId: "ec2-instance",
          name: "web",
          tags: { Team: "core", App: "shop" },
          config: { instanceType: "t3.micro" },
        }),
      ]),
    );
    expect(rows.map((r) => r.id)).toEqual(["a", "b"]); // sorted
    const a = rows[0];
    expect(a.service).toContain("Elastic Compute"); // registry fullName
    expect(a.category).toBe("compute");
    expect(a.nativeType).toBe("AWS::EC2::Instance");
    expect(a.tags).toBe("App=shop; Team=core"); // sorted k=v
    expect(a.monthlyCost).toBe(8); // t3.micro
    expect(rows[1].monthlyCost).toBe(32); // nat
  });

  it("keeps unpriced cost as null (distinct from free/0)", () => {
    const rows = resourceInventory(graph([res({ id: "k", serviceId: "kendra" })]));
    expect(rows[0].monthlyCost).toBeNull();
  });
});

describe("billOfMaterials", () => {
  it("rolls up counts + cost per service type, highest spend first", () => {
    const bom = billOfMaterials(
      graph([
        res({ id: "n1", serviceId: "nat-gateway" }), // 32
        res({ id: "n2", serviceId: "nat-gateway" }), // 32
        res({ id: "e1", serviceId: "ec2-instance", config: { instanceType: "t3.micro" } }), // 8
        res({ id: "k1", serviceId: "kendra" }), // unpriced
      ]),
    );
    expect(bom.totalResources).toBe(4);
    expect(bom.totalMonthly).toBe(72); // 32+32+8
    expect(bom.unpricedResources).toBe(1);
    // NAT first (highest total spend), then EC2, then Kendra (0).
    expect(bom.rows[0].serviceId).toBe("nat-gateway");
    expect(bom.rows[0].count).toBe(2);
    expect(bom.rows[0].monthlyCost).toBe(64);
    const kendra = bom.rows.find((r) => r.serviceId === "kendra")!;
    expect(kendra.unpriced).toBe(1);
    expect(kendra.monthlyCost).toBe(0);
  });
});

describe("toCsv", () => {
  it("escapes commas, quotes, and newlines per RFC 4180", () => {
    const csv = toCsv(
      ["a", "b"],
      [
        ["plain", "has,comma"],
        ['has"quote', "line\nbreak"],
      ],
    );
    expect(csv).toBe('a,b\r\nplain,"has,comma"\r\n"has""quote","line\nbreak"');
  });
});

describe("inventoryCsv / bomCsv", () => {
  it("inventoryCsv emits a header + one row per resource", () => {
    const csv = inventoryCsv(graph([res({ id: "v", serviceId: "vpc", name: "main" })]));
    const lines = csv.split("\r\n");
    expect(lines[0]).toContain("id,name,serviceId");
    expect(lines).toHaveLength(2);
    expect(lines[1].startsWith("v,main,vpc")).toBe(true);
  });

  it("bomCsv ends with a TOTAL row", () => {
    const csv = bomCsv(graph([res({ id: "n", serviceId: "nat-gateway" })]));
    const lines = csv.split("\r\n");
    expect(lines[lines.length - 1].startsWith("TOTAL,")).toBe(true);
  });
});
