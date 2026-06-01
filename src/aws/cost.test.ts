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

  it("estimates a NAT gateway and an RDS class", () => {
    expect(estimateMonthlyCost(res("nat-gateway"))).toBe(32);
    expect(estimateMonthlyCost(res("rds", { instanceClass: "db.m5.large" }))).toBe(125);
  });

  it("covers GCP and Azure compute", () => {
    expect(estimateMonthlyCost(res("gcp-compute-engine", { machineType: "e2-micro" }))).toBe(6);
    expect(estimateMonthlyCost(res("azure-vm", { vmSize: "Standard_B2s" }))).toBe(30);
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
