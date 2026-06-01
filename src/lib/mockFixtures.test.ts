import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { importAnyIaC } from "./importIac";
import { getService, serviceProvider } from "../aws/registry";

/** Read a shipped fixture from `mock-data/` (vitest runs with the repo root as cwd). */
const fixture = (file: string) =>
  fs.readFileSync(path.join(process.cwd(), "mock-data", file), "utf8");

/** Whether a fixture exists, so a missing file skips its block rather than failing. */
const has = (file: string) => fs.existsSync(path.join(process.cwd(), "mock-data", file));

describe("mock-data fixtures — native graphs", () => {
  it.runIf(has("aws-three-tier.json"))("aws-three-tier.json is a valid native graph", () => {
    const g = JSON.parse(fixture("aws-three-tier.json"));
    expect(Array.isArray(g.resources)).toBe(true);
    expect(Array.isArray(g.relationships)).toBe(true);
    expect(typeof g.schemaVersion).toBe("number");
    expect(g.resources).toHaveLength(11);
    expect(g.relationships).toHaveLength(12);
    for (const r of g.resources) expect(getService(r.serviceId)).toBeDefined();
  });

  it.runIf(has("multicloud-showcase.json"))(
    "multicloud-showcase.json is a valid native graph",
    () => {
      const g = JSON.parse(fixture("multicloud-showcase.json"));
      expect(Array.isArray(g.resources)).toBe(true);
      expect(Array.isArray(g.relationships)).toBe(true);
      expect(typeof g.schemaVersion).toBe("number");
      expect(g.resources).toHaveLength(9);
      expect(g.relationships).toHaveLength(6);
      for (const r of g.resources) expect(getService(r.serviceId)).toBeDefined();
    },
  );
});

describe("mock-data fixtures — IaC import", () => {
  it.runIf(has("cloudformation-sample.json"))("imports the CloudFormation sample", () => {
    const r = importAnyIaC(fixture("cloudformation-sample.json"));
    expect(r.format).toBe("cloudformation");
    expect(r.graph.resources).toHaveLength(8);
    expect(r.unmappedTypes).toHaveLength(0);
  });

  it.runIf(has("arm-sample.json"))("imports the Azure ARM sample", () => {
    const r = importAnyIaC(fixture("arm-sample.json"));
    expect(r.format).toBe("arm");
    expect(r.graph.resources).toHaveLength(3);
    // All three resolve to Azure services (provider lives on the registry entry).
    for (const res of r.graph.resources) {
      expect(serviceProvider(getService(res.serviceId)!)).toBe("azure");
    }
    // ARM `dependsOn` becomes a `depends_on` relationship.
    expect(r.graph.relationships.some((rel) => rel.kind === "depends_on")).toBe(true);
  });

  it.runIf(has("terraform-aws-state.json"))("imports the Terraform AWS state sample", () => {
    const r = importAnyIaC(fixture("terraform-aws-state.json"));
    expect(r.format).toBe("terraform");
    expect(r.graph.resources.map((res) => res.serviceId)).toEqual([
      "vpc",
      "subnet-private",
      "ec2-instance",
      "s3-bucket",
    ]);
    expect(r.unmappedTypes).toHaveLength(0);
    // The subnet and instance are contained (parentId set); vpc/bucket are top-level.
    const byService = new Map(r.graph.resources.map((res) => [res.serviceId, res]));
    expect(byService.get("subnet-private")!.parentId).toBeTruthy();
    expect(byService.get("ec2-instance")!.parentId).toBeTruthy();
  });
});
