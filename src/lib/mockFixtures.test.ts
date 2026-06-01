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

/**
 * Every native graph fixture (anything in mock-data/ with a numeric
 * schemaVersion) must be internally consistent: known serviceIds, and edges /
 * parentIds that reference resources actually present in the graph. This
 * auto-covers any fixture added later — including the larger-scale examples —
 * so a typo'd serviceId or dangling edge fails CI.
 */
describe("mock-data fixtures — native graph integrity (all files)", () => {
  const dir = path.join(process.cwd(), "mock-data");
  const nativeGraphs = fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => ({ file: f, graph: JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) }))
        .filter((x) => typeof x.graph.schemaVersion === "number")
    : [];

  it("found native graph fixtures to check", () => {
    expect(nativeGraphs.length).toBeGreaterThan(0);
  });

  for (const { file, graph } of nativeGraphs) {
    describe(file, () => {
      const ids = new Set<string>(graph.resources.map((r: { id: string }) => r.id));

      it("has unique resource ids", () => {
        expect(ids.size).toBe(graph.resources.length);
      });

      it("uses only registry serviceIds", () => {
        const bad = graph.resources
          .filter((r: { serviceId: string }) => !getService(r.serviceId))
          .map((r: { serviceId: string }) => r.serviceId);
        expect(bad).toEqual([]);
      });

      it("has parentIds that reference existing resources", () => {
        const dangling = graph.resources
          .filter((r: { parentId?: string }) => r.parentId && !ids.has(r.parentId))
          .map((r: { id: string; parentId?: string }) => `${r.id}->${r.parentId}`);
        expect(dangling).toEqual([]);
      });

      it("has relationships whose endpoints exist", () => {
        const dangling = graph.relationships
          .filter((e: { from: string; to: string }) => !ids.has(e.from) || !ids.has(e.to))
          .map((e: { from: string; to: string }) => `${e.from}->${e.to}`);
        expect(dangling).toEqual([]);
      });
    });
  }
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

  it.runIf(has("terraform-aws-large-state.json"))(
    "imports the large multi-module Terraform state",
    () => {
      const r = importAnyIaC(fixture("terraform-aws-large-state.json"));
      expect(r.format).toBe("terraform");
      // Every resource type maps (root + both child modules walked): nothing dropped.
      expect(r.unmappedTypes).toHaveLength(0);
      expect(r.graph.resources).toHaveLength(31);

      const byId = new Map(r.graph.resources.map((res) => [res.id, res]));
      // Containment resolves across modules via vpc_id / subnet_id references.
      expect(byId.get("module.network.aws_subnet.private_a")!.parentId).toBe("aws_vpc.main");
      expect(byId.get("module.app.aws_ecs_service.web")!.parentId).toBe(
        "module.network.aws_subnet.private_a",
      );
      // Newly-mapped Terraform types resolve to real services.
      expect(byId.get("module.app.aws_eks_node_group.default")!.serviceId).toBe("eks-cluster");
      expect(byId.get("module.app.aws_ecs_task_definition.web")!.serviceId).toBe("fargate");
      expect(byId.get("module.network.aws_lb_listener.https")!.serviceId).toBe(
        "elastic-load-balancer",
      );
    },
  );
});
