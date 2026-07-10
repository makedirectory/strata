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

  it("prices OpenSearch Serverless by OCU floor; ENABLED standby ≈ 2× DISABLED", () => {
    // DISABLED → 2 OCU × $0.24 × 730 = 350.4; ENABLED → 4 OCU = 700.8.
    const disabled = estimateMonthlyCost(
      res("opensearch-serverless", { standbyReplicas: "DISABLED" }),
    )!;
    const enabled = estimateMonthlyCost(
      res("opensearch-serverless", { standbyReplicas: "ENABLED" }),
    )!;
    expect(disabled).toBeCloseTo(350.4);
    expect(enabled).toBeCloseTo(700.8);
    expect(enabled).toBeCloseTo(disabled * 2);
    // Unset defaults to the redundant (ENABLED) floor — never a silent $0.
    expect(estimateMonthlyCost(res("opensearch-serverless"))).toBeCloseTo(700.8);
  });

  it("prices Fargate by vCPU + memory × desiredCount, base when unsized", () => {
    // 0.5 vCPU (512 units) + 1 GB (1024 MiB): (0.5×0.04048 + 1×0.004445) × 730 ≈ 18.02
    expect(estimateMonthlyCost(res("fargate", { cpu: "512", memory: "1024" }))).toBeCloseTo(
      18.02,
      1,
    );
    // desiredCount scales it (only meaningful when cpu/mem are present on the node).
    expect(
      estimateMonthlyCost(res("fargate", { cpu: "512", memory: "1024", desiredCount: 3 })),
    ).toBeCloseTo(54.06, 1);
    // An ecs-service without task dimensions falls back to the flat base (30).
    expect(estimateMonthlyCost(res("ecs-service", { desiredCount: 4 }))).toBe(30);
  });

  it("prices Elastic IP as the hourly public-IPv4 charge (never $0)", () => {
    // $0.005/hr × 730 = 3.65, idle or attached.
    expect(estimateMonthlyCost(res("elastic-ip", { attached: false }))).toBeCloseTo(3.65);
    expect(estimateMonthlyCost(res("elastic-ip", { attached: true }))).toBeCloseTo(3.65);
  });

  it("prices VPC Flow Logs conservatively by destination + retention", () => {
    // cloud-watch-logs, 30d: 5×0.5 + 5×0.03 = 2.65; s3 is cheaper per GB.
    expect(estimateMonthlyCost(res("vpc-flow-logs"))).toBeCloseTo(2.65);
    const s3 = estimateMonthlyCost(res("vpc-flow-logs", { destinationType: "s3" }))!;
    expect(s3).toBeLessThan(2.65);
    // Longer retention grows the storage component.
    expect(estimateMonthlyCost(res("vpc-flow-logs", { retentionDays: 90 }))!).toBeGreaterThan(2.65);
  });

  it("prices the kickoff-named billables (sagemaker, bedrock) instead of $0", () => {
    expect(estimateMonthlyCost(res("sagemaker"))).toBeGreaterThan(0);
    expect(estimateMonthlyCost(res("bedrock"))).toBeGreaterThan(0);
    expect(estimateMonthlyCost(res("bedrock-knowledge-base"))).toBeGreaterThan(0);
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

  it("flags the total as a FLOOR when a billable type is unmapped", () => {
    const r = estimateTotal([
      res("ec2-instance", { instanceType: "t3.micro" }), // priced
      res("app-runner"), // billable but unpriced
      res("kendra"), // billable but unpriced
    ]);
    expect(r.isFloor).toBe(true);
    // Sorted, de-duplicated list of the gaps.
    expect(r.unmappedBillableTypes).toEqual(["app-runner", "kendra"]);
  });

  it("does NOT flag a floor for priced + known-free services", () => {
    const r = estimateTotal([
      res("ec2-instance", { instanceType: "t3.micro" }), // priced
      res("iam-role"), // known-free (null, but not a gap)
      res("cloudformation"), // known-free
      res("vpc"), // free/structural (priced 0)
    ]);
    expect(r.isFloor).toBe(false);
    expect(r.unmappedBillableTypes).toEqual([]);
    // Known-free services still count as unknown (unpriced), just not as a gap.
    expect(r.unknown).toBe(2);
  });

  it("de-duplicates repeated unmapped billable types (multi-account floor)", () => {
    const r = estimateTotal([res("kendra"), res("kendra"), res("kendra")]);
    expect(r.unmappedBillableTypes).toEqual(["kendra"]);
    expect(r.isFloor).toBe(true);
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
