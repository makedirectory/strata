import { describe, it, expect } from "vitest";
import { mergeGraphs } from "./merge";
import { emptyGraph, type InfrastructureGraph, type ResourceInstance } from "./model";

function res(
  over: Partial<ResourceInstance> & { id: string; serviceId: string },
): ResourceInstance {
  return { name: over.id, config: {}, source: "manual", ...over };
}
function graph(resources: ResourceInstance[], relationships = []): InfrastructureGraph {
  return { ...emptyGraph(), resources, relationships };
}

describe("mergeGraphs", () => {
  it("updates a matched resource in place, preserving id/position, reconciling config", () => {
    const base = graph([
      res({
        id: "uuid-1",
        serviceId: "rds",
        name: "DB",
        position: { x: 100, y: 200, w: 240, h: 100 },
        config: { instanceClass: "db.t3.micro", multiAz: false },
        source: "manual",
      }),
    ]);
    // Re-scan: same logical resource (matched by serviceId+name), updated config.
    const incoming = graph([
      res({
        id: "scan-9",
        serviceId: "rds",
        name: "DB",
        config: { instanceClass: "db.m5.large", multiAz: true },
        source: "mcp",
      }),
    ]);
    const { graph: out, added, updated } = mergeGraphs(base, incoming);
    expect(added).toBe(0);
    expect(updated).toBe(1);
    expect(out.resources).toHaveLength(1);
    const r = out.resources[0];
    expect(r.id).toBe("uuid-1"); // internal id preserved
    expect(r.position).toEqual({ x: 100, y: 200, w: 240, h: 100 }); // placement preserved
    expect(r.config).toEqual({ instanceClass: "db.m5.large", multiAz: true }); // reconciled
  });

  it("matches by ARN even when names differ, and refreshes arn/region", () => {
    const base = graph([
      res({ id: "a", serviceId: "s3-bucket", name: "old", arn: "arn:aws:s3:::b" }),
    ]);
    const incoming = graph([
      res({
        id: "b",
        serviceId: "s3-bucket",
        name: "new",
        arn: "arn:aws:s3:::b",
        region: "us-east-1",
      }),
    ]);
    const { graph: out, updated } = mergeGraphs(base, incoming);
    expect(updated).toBe(1);
    expect(out.resources).toHaveLength(1);
    expect(out.resources[0].name).toBe("old"); // user's name kept
    expect(out.resources[0].region).toBe("us-east-1"); // refreshed from scan
  });

  it("adds genuinely new resources and leaves unmatched base resources untouched", () => {
    const base = graph([res({ id: "keep", serviceId: "vpc", name: "Main" })]);
    const incoming = graph([res({ id: "new", serviceId: "s3-bucket", name: "Assets" })]);
    const { graph: out, added, updated } = mergeGraphs(base, incoming);
    expect(added).toBe(1);
    expect(updated).toBe(0);
    expect(out.resources.map((r) => r.id).sort()).toEqual(["keep", "new"]);
  });

  it("re-merging the same scan is idempotent (no duplicates)", () => {
    const base = graph([res({ id: "a", serviceId: "vpc", name: "Main" })]);
    const scan = graph([
      res({ id: "x", serviceId: "vpc", name: "Main" }),
      res({ id: "y", serviceId: "s3-bucket", name: "Assets" }),
    ]);
    const once = mergeGraphs(base, scan).graph;
    const twice = mergeGraphs(once, scan).graph;
    expect(once.resources).toHaveLength(2);
    expect(twice.resources).toHaveLength(2); // second merge adds nothing
  });

  it("remaps incoming relationship endpoints onto matched base ids and dedups", () => {
    const base = graph([
      res({ id: "vpc-1", serviceId: "vpc", name: "Main" }),
      res({ id: "sn-1", serviceId: "subnet-public", name: "Public" }),
    ]);
    const incoming = graph(
      [
        res({ id: "vpc-x", serviceId: "vpc", name: "Main" }),
        res({ id: "sn-x", serviceId: "subnet-public", name: "Public" }),
      ],
      [{ id: "e1", from: "vpc-x", to: "sn-x", kind: "contains", source: "mcp" }] as never,
    );
    const { graph: out } = mergeGraphs(base, incoming);
    expect(out.resources).toHaveLength(2); // both matched, none added
    expect(out.relationships).toHaveLength(1);
    // endpoints remapped to the existing base ids
    expect(out.relationships[0].from).toBe("vpc-1");
    expect(out.relationships[0].to).toBe("sn-1");
  });
});
