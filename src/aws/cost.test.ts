import { describe, it, expect } from "vitest";
import { estimateMonthlyCost, estimateTotal, formatMonthly } from "./cost";
import type { ResourceInstance } from "./model";

function res(serviceId: string, config: Record<string, unknown> = {}): ResourceInstance {
  return { id: serviceId, serviceId, name: serviceId, config, source: "manual" };
}

describe("estimateMonthlyCost", () => {
  it("refines EC2 by instance type, falling back to a base for unknown types", () => {
    expect(estimateMonthlyCost(res("ec2-instance", { instanceType: "t3.micro" }))).toBe(8);
    expect(estimateMonthlyCost(res("ec2-instance", { instanceType: "weird.size" }))).toBe(50);
    expect(estimateMonthlyCost(res("ec2-instance"))).toBe(50);
  });

  it("treats structural/free services as 0 and unknown services as null", () => {
    expect(estimateMonthlyCost(res("vpc"))).toBe(0);
    expect(estimateMonthlyCost(res("security-group"))).toBe(0);
    expect(estimateMonthlyCost(res("totally-made-up"))).toBeNull();
  });

  it("clamps negative count/storage config so estimates never go below zero", () => {
    // Negative replicaCount must not zero-out or invert the writer cost.
    expect(estimateMonthlyCost(res("aurora", { replicaCount: -5 }))!).toBeGreaterThan(0);
    // Negative storage must not subtract from the instance cost.
    const rds = estimateMonthlyCost(res("rds", { allocatedStorage: -100 }))!;
    expect(rds).toBeGreaterThan(0);
    // Storage-only services floor at 0, never negative.
    expect(estimateMonthlyCost(res("ebs-volume", { sizeGiB: -50 }))).toBe(0);
    expect(estimateMonthlyCost(res("fsx", { storageCapacityGiB: -10 }))).toBe(0);
    // And a bad-config resource can't drag the diagram total negative.
    expect(estimateTotal([res("ebs-volume", { sizeGiB: -9999 })]).total).toBeGreaterThanOrEqual(0);
  });

  it("estimates a NAT gateway and an RDS class (incl. default storage)", () => {
    expect(estimateMonthlyCost(res("nat-gateway"))).toBe(32);
    // db.m5.large (125) + default 20 GiB × $0.115 = 127.3
    expect(estimateMonthlyCost(res("rds", { instanceClass: "db.m5.large" }))).toBeCloseTo(127.3);
  });

  it("covers GCP and Azure compute", () => {
    expect(estimateMonthlyCost(res("gcp-compute-engine", { machineType: "e2-micro" }))).toBe(6);
    expect(estimateMonthlyCost(res("azure-vm", { vmSize: "Standard_B2s" }))).toBe(30);
  });

  it("factors in multi-AZ and storage for RDS", () => {
    // 125 × 2 (multi-AZ) + 100 GiB × $0.115 = 261.5
    const c = estimateMonthlyCost(
      res("rds", { instanceClass: "db.m5.large", multiAz: true, allocatedStorage: 100 }),
    );
    expect(c).toBeCloseTo(261.5);
  });

  it("scales by count: ASG capacity, cache nodes, Aurora replicas", () => {
    expect(estimateMonthlyCost(res("auto-scaling-group", { desiredCapacity: 4 }))).toBe(200);
    expect(
      estimateMonthlyCost(res("elasticache", { nodeType: "cache.t3.medium", numNodes: 3 })),
    ).toBe(150);
    // writer + 2 replicas = 3 × 100 (default class price)
    expect(estimateMonthlyCost(res("aurora", { replicaCount: 2 }))).toBe(300);
  });

  it("prices EBS by size × volume-type $/GiB", () => {
    // 200 GiB gp3 ($0.08) = 16
    expect(estimateMonthlyCost(res("ebs-volume", { sizeGiB: 200, volumeType: "gp3" }))).toBe(16);
  });
});

describe("estimateTotal", () => {
  it("sums estimable resources and counts unknowns", () => {
    const r = estimateTotal([
      res("ec2-instance", { instanceType: "t3.micro" }), // 8
      res("nat-gateway"), // 32
      res("vpc"), // 0
      res("totally-made-up"), // null
    ]);
    expect(r.total).toBe(40);
    expect(r.estimated).toBe(3);
    expect(r.unknown).toBe(1);
  });
});

describe("formatMonthly", () => {
  it("formats dollars, thousands, free and unknown", () => {
    expect(formatMonthly(32)).toBe("$32/mo");
    expect(formatMonthly(1500)).toBe("$1.5k/mo");
    expect(formatMonthly(0)).toBe("free");
    expect(formatMonthly(null)).toBe("—");
  });
});
