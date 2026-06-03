/**
 * Tests for the multi-cloud equivalence mapper (`mapToCloud`).
 *
 * These assert against real registry service ids (resolved at module load), so
 * a registry rename would surface here. They cover the happy path (category +
 * capability translation across aws/gcp/azure), honest unmapped reporting,
 * relationship/parent pruning, no-mutation guarantees and idempotency.
 */
import { describe, it, expect } from "vitest";
import { mapToCloud } from "./cloudMap";
import { emptyGraph } from "./model";
import type { InfrastructureGraph, ResourceInstance, Relationship } from "./model";
import { getService, serviceProvider } from "./registry";

function res(id: string, serviceId: string, extra: Partial<ResourceInstance> = {}): ResourceInstance {
  return { id, serviceId, name: id, config: {}, source: "manual", ...extra };
}

function graphWith(
  resources: ResourceInstance[],
  relationships: Relationship[] = [],
): InfrastructureGraph {
  return { ...emptyGraph("test"), resources, relationships };
}

describe("mapToCloud — capability-aware translation", () => {
  it("maps AWS storage/db/compute to the GCP equivalents", () => {
    const g = graphWith([
      res("r1", "s3-bucket"),
      res("r2", "rds"),
      res("r3", "dynamodb"),
      res("r4", "ec2-instance"),
      res("r5", "lambda"),
    ]);
    const { graph, unmapped } = mapToCloud(g, "gcp");
    expect(unmapped).toEqual([]);
    const byId = new Map(graph.resources.map((r) => [r.id, r.serviceId]));
    expect(byId.get("r1")).toBe("gcp-cloud-storage"); // object-store
    expect(byId.get("r2")).toBe("gcp-cloud-sql"); // relational-db
    expect(byId.get("r3")).toBe("gcp-bigtable"); // nosql-db (not relational)
    expect(byId.get("r4")).toBe("gcp-compute-engine"); // vm
    expect(byId.get("r5")).toBe("gcp-cloud-functions"); // serverless-fn
  });

  it("maps AWS to Azure equivalents", () => {
    const g = graphWith([
      res("r1", "s3-bucket"),
      res("r2", "ec2-instance"),
      res("r3", "dynamodb"),
    ]);
    const { graph } = mapToCloud(g, "azure");
    const byId = new Map(graph.resources.map((r) => [r.id, r.serviceId]));
    expect(byId.get("r1")).toBe("azure-blob-container");
    expect(byId.get("r2")).toBe("azure-vm");
    expect(byId.get("r3")).toBe("azure-cosmos-db");
  });

  it("does not treat a firewall/security-group as a VPC network container", () => {
    const g = graphWith([res("net", "vpc"), res("sg", "security-group"), res("sub", "subnet-public")]);
    const { graph } = mapToCloud(g, "gcp");
    const byId = new Map(graph.resources.map((r) => [r.id, r.serviceId]));
    expect(byId.get("net")).toBe("gcp-vpc-network");
    expect(byId.get("sg")).toBe("gcp-firewall-rule");
    expect(byId.get("sub")).toBe("gcp-subnet");
  });

  it("every rewritten resource resolves to a real service on the target provider", () => {
    const g = graphWith([
      res("r1", "s3-bucket"),
      res("r2", "rds"),
      res("r3", "nat-gateway"),
      res("r4", "sqs"),
      res("r5", "redshift"),
    ]);
    const { graph } = mapToCloud(g, "gcp");
    for (const r of graph.resources) {
      const svc = getService(r.serviceId);
      expect(svc, `service ${r.serviceId} should exist`).toBeDefined();
      expect(serviceProvider(svc!)).toBe("gcp");
    }
  });
});

describe("mapToCloud — passthrough and idempotency", () => {
  it("keeps a resource already on the target provider verbatim", () => {
    const g = graphWith([res("r1", "gcp-cloud-storage")]);
    const { graph, unmapped } = mapToCloud(g, "gcp");
    expect(unmapped).toEqual([]);
    expect(graph.resources[0].serviceId).toBe("gcp-cloud-storage");
  });

  it("mapping to the same provider is a no-op on serviceIds", () => {
    const g = graphWith([res("r1", "s3-bucket"), res("r2", "ec2-instance")]);
    const { graph } = mapToCloud(g, "aws");
    expect(graph.resources.map((r) => r.serviceId)).toEqual(["s3-bucket", "ec2-instance"]);
  });

  it("mapping is stable when re-run on its own output (idempotent)", () => {
    const g = graphWith([res("r1", "s3-bucket"), res("r2", "rds")]);
    const once = mapToCloud(g, "gcp").graph;
    const twice = mapToCloud(once, "gcp").graph;
    expect(twice.resources.map((r) => r.serviceId)).toEqual(once.resources.map((r) => r.serviceId));
  });
});

describe("mapToCloud — honest unmapped reporting", () => {
  it("reports an unknown service id instead of dropping it silently", () => {
    const g = graphWith([res("r1", "not-a-real-service")]);
    const { graph, unmapped } = mapToCloud(g, "gcp");
    expect(graph.resources).toEqual([]);
    expect(unmapped).toHaveLength(1);
    expect(unmapped[0]).toMatchObject({
      resourceId: "r1",
      serviceId: "not-a-real-service",
      category: "unknown",
    });
    expect(unmapped[0].reason).toContain("Unknown service id");
  });

  it("reports a resource whose category has no equivalent in the target", () => {
    // monitoring is an AWS-only category here (no gcp entries in the registry).
    const monService = getService("cloudwatch");
    expect(monService?.category).toBe("monitoring");
    const g = graphWith([res("r1", "cloudwatch")]);
    const { graph, unmapped } = mapToCloud(g, "gcp");
    expect(graph.resources).toEqual([]);
    expect(unmapped).toHaveLength(1);
    expect(unmapped[0]).toMatchObject({ resourceId: "r1", serviceId: "cloudwatch", category: "monitoring" });
    expect(unmapped[0].reason).toContain("category");
  });

  it("sorts unmapped entries deterministically by resourceId", () => {
    const g = graphWith([res("zzz", "cloudwatch"), res("aaa", "another-unknown")]);
    const { unmapped } = mapToCloud(g, "gcp");
    expect(unmapped.map((u) => u.resourceId)).toEqual(["aaa", "zzz"]);
  });
});

describe("mapToCloud — relationship and parent pruning", () => {
  it("drops relationships referencing an unmapped resource", () => {
    const g = graphWith(
      [res("ok", "s3-bucket"), res("bad", "cloudwatch")],
      [{ id: "e1", from: "ok", to: "bad", kind: "depends_on" }],
    );
    const { graph } = mapToCloud(g, "gcp");
    expect(graph.resources).toHaveLength(1);
    expect(graph.relationships).toEqual([]);
  });

  it("keeps relationships whose endpoints both survive", () => {
    const g = graphWith(
      [res("a", "ec2-instance"), res("b", "s3-bucket")],
      [{ id: "e1", from: "a", to: "b", kind: "writes_to" }],
    );
    const { graph } = mapToCloud(g, "gcp");
    expect(graph.relationships).toHaveLength(1);
    expect(graph.relationships[0]).toMatchObject({ id: "e1", from: "a", to: "b" });
  });

  it("clears a parentId that points at a dropped resource", () => {
    const g = graphWith([
      res("parent", "cloudwatch"),
      res("child", "ec2-instance", { parentId: "parent" }),
    ]);
    const { graph } = mapToCloud(g, "gcp");
    const child = graph.resources.find((r) => r.id === "child");
    expect(child?.parentId).toBeUndefined();
  });

  it("preserves a parentId when the parent survives", () => {
    const g = graphWith([
      res("vpc1", "vpc"),
      res("sub1", "subnet-public", { parentId: "vpc1" }),
    ]);
    const { graph } = mapToCloud(g, "gcp");
    const sub = graph.resources.find((r) => r.id === "sub1");
    expect(sub?.parentId).toBe("vpc1");
  });
});

describe("mapToCloud — immutability", () => {
  it("never mutates the input graph", () => {
    const g = graphWith(
      [res("r1", "s3-bucket", { tags: { env: "prod" }, config: { versioning: true } })],
      [],
    );
    const snapshot = JSON.parse(JSON.stringify(g));
    const { graph } = mapToCloud(g, "gcp");
    expect(g).toEqual(snapshot); // input untouched
    expect(graph).not.toBe(g);
    expect(graph.resources[0]).not.toBe(g.resources[0]);
    // config/tags are cloned, not shared.
    expect(graph.resources[0].config).not.toBe(g.resources[0].config);
    expect(graph.resources[0].tags).not.toBe(g.resources[0].tags);
    expect(graph.resources[0].config).toEqual({ versioning: true });
    expect(graph.resources[0].tags).toEqual({ env: "prod" });
  });

  it("returns an empty mapping for an empty graph", () => {
    const { graph, unmapped } = mapToCloud(emptyGraph("e"), "azure");
    expect(graph.resources).toEqual([]);
    expect(graph.relationships).toEqual([]);
    expect(unmapped).toEqual([]);
  });
});
