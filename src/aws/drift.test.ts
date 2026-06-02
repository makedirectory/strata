import { describe, it, expect } from "vitest";
import { diffGraphs } from "./drift";
import { emptyGraph, type InfrastructureGraph, type ResourceInstance } from "./model";

function res(
  over: Partial<ResourceInstance> & { id: string; serviceId: string },
): ResourceInstance {
  return { name: over.id, config: {}, source: "manual", ...over };
}
function graph(resources: ResourceInstance[]): InfrastructureGraph {
  return { ...emptyGraph(), resources };
}

describe("diffGraphs", () => {
  it("reports inSync for identical graphs", () => {
    const g = graph([
      res({ id: "a", serviceId: "vpc", name: "Main", config: { cidr: "10.0.0.0/16" } }),
    ]);
    const r = diffGraphs(
      g,
      graph([res({ id: "a", serviceId: "vpc", name: "Main", config: { cidr: "10.0.0.0/16" } })]),
    );
    expect(r.inSync).toBe(true);
    expect(r.unchanged).toBe(1);
  });

  it("detects added and removed resources", () => {
    const current = graph([
      res({ id: "a", serviceId: "vpc", name: "Main" }),
      res({ id: "b", serviceId: "s3-bucket", name: "Assets" }),
    ]);
    const baseline = graph([
      res({ id: "a", serviceId: "vpc", name: "Main" }),
      res({ id: "c", serviceId: "rds", name: "DB" }),
    ]);
    const r = diffGraphs(current, baseline);
    expect(r.added.map((x) => x.serviceId)).toEqual(["s3-bucket"]);
    expect(r.removed.map((x) => x.serviceId)).toEqual(["rds"]);
    expect(r.inSync).toBe(false);
  });

  it("detects config changes on matched resources", () => {
    const current = graph([
      res({
        id: "a",
        serviceId: "rds",
        name: "DB",
        config: { instanceClass: "db.m5.large", multiAz: true },
      }),
    ]);
    const baseline = graph([
      res({
        id: "a",
        serviceId: "rds",
        name: "DB",
        config: { instanceClass: "db.t3.micro", multiAz: false },
      }),
    ]);
    const r = diffGraphs(current, baseline);
    expect(r.changed).toHaveLength(1);
    const keys = r.changed[0].changes.map((c) => c.key).sort();
    expect(keys).toEqual(["instanceClass", "multiAz"]);
    const mz = r.changed[0].changes.find((c) => c.key === "multiAz")!;
    expect(mz.from).toBe(false);
    expect(mz.to).toBe(true);
  });

  it("matches across differing ids via serviceId + name (cross-source)", () => {
    // A diagram (UUID id) vs an import (logical id) for the same logical resource.
    const current = graph([
      res({ id: "uuid-1", serviceId: "vpc", name: "Main", config: { cidr: "10.0.0.0/16" } }),
    ]);
    const baseline = graph([
      res({ id: "MainVpc", serviceId: "vpc", name: "Main", config: { cidr: "10.1.0.0/16" } }),
    ]);
    const r = diffGraphs(current, baseline);
    expect(r.added).toHaveLength(0);
    expect(r.removed).toHaveLength(0);
    expect(r.changed).toHaveLength(1);
    expect(r.changed[0].changes[0].key).toBe("cidr");
  });

  it("matches by ARN when names differ", () => {
    const current = graph([
      res({
        id: "x",
        serviceId: "s3-bucket",
        name: "renamed",
        arn: "arn:aws:s3:::b",
        config: { versioning: true },
      }),
    ]);
    const baseline = graph([
      res({
        id: "y",
        serviceId: "s3-bucket",
        name: "original",
        arn: "arn:aws:s3:::b",
        config: { versioning: false },
      }),
    ]);
    const r = diffGraphs(current, baseline);
    expect(r.changed).toHaveLength(1);
    expect(r.changed[0].changes[0].key).toBe("versioning");
  });
});
