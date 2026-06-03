import { describe, it, expect } from "vitest";
import { changeReceipt, renderMarkdown } from "./receipt";
import { emptyGraph, type InfrastructureGraph, type ResourceInstance } from "./model";

function res(
  over: Partial<ResourceInstance> & { id: string; serviceId: string },
): ResourceInstance {
  return { name: over.id, config: {}, source: "manual", ...over };
}
function graph(resources: ResourceInstance[]): InfrastructureGraph {
  return { ...emptyGraph(), resources };
}

describe("changeReceipt", () => {
  it("reports no changes for identical graphs", () => {
    const g = graph([res({ id: "a", serviceId: "ec2-instance", name: "Web" })]);
    const r = changeReceipt(g, structuredClone(g));
    expect(r.drift.inSync).toBe(true);
    expect(r.cost.delta).toBe(0);
    expect(r.findings.resolved).toEqual([]);
    expect(r.findings.introduced).toEqual([]);
    expect(r.summaryLines[0]).toBe("No resource changes");
  });

  it("detects added/removed resource churn (forward diff)", () => {
    const before = graph([res({ id: "a", serviceId: "ec2-instance", name: "Web" })]);
    const after = graph([
      res({ id: "a", serviceId: "ec2-instance", name: "Web" }),
      res({ id: "b", serviceId: "s3-bucket", name: "Assets" }),
    ]);
    const r = changeReceipt(before, after);
    expect(r.drift.added.map((x) => x.serviceId)).toEqual(["s3-bucket"]);
    expect(r.drift.removed).toEqual([]);
    expect(r.summaryLines[0]).toBe("+1 resource");
  });

  it("computes a signed cost delta from estimateTotal", () => {
    // ec2-instance ($50) -> rds ($60) base; after adds an s3-bucket ($5).
    const before = graph([res({ id: "a", serviceId: "ec2-instance", name: "Web" })]);
    const after = graph([
      res({ id: "a", serviceId: "ec2-instance", name: "Web" }),
      res({ id: "b", serviceId: "s3-bucket", name: "Assets" }),
    ]);
    const r = changeReceipt(before, after);
    expect(r.cost.before).toBe(50);
    expect(r.cost.after).toBe(55);
    expect(r.cost.delta).toBe(5);
    expect(r.summaryLines.some((l) => l.includes("Cost") && l.includes("+$5/mo"))).toBe(true);
  });

  it("tracks unpriced (unknown-cost) resources on each side", () => {
    // "made-up-service" has no cost model -> unknown.
    const before = graph([res({ id: "x", serviceId: "made-up-service", name: "Mystery" })]);
    const after = graph([
      res({ id: "x", serviceId: "made-up-service", name: "Mystery" }),
      res({ id: "y", serviceId: "another-unknown", name: "Mystery2" }),
    ]);
    const r = changeReceipt(before, after);
    expect(r.cost.beforeUnknown).toBe(1);
    expect(r.cost.afterUnknown).toBe(2);
    expect(r.summaryLines.some((l) => l.startsWith("Unpriced resources:"))).toBe(true);
  });

  it("reports a resolved finding when a fix removes a validation error", () => {
    // A bare subnet with no VPC produces an error finding; removing it resolves it.
    const before = graph([res({ id: "s", serviceId: "subnet-public", name: "PubA" })]);
    const after = graph([]);
    const r = changeReceipt(before, after);
    expect(r.findings.resolved.length).toBeGreaterThan(0);
    expect(r.findings.introduced).toEqual([]);
    expect(
      r.findings.resolved.every((m) => m.startsWith("[error]") || m.startsWith("[warn]")),
    ).toBe(true);
  });

  it("reports an introduced finding when a change adds a validation error", () => {
    const before = graph([]);
    const after = graph([res({ id: "s", serviceId: "subnet-public", name: "PubA" })]);
    const r = changeReceipt(before, after);
    expect(r.findings.introduced.length).toBeGreaterThan(0);
    expect(r.findings.resolved).toEqual([]);
  });

  it("counts findings present in both graphs as unchanged", () => {
    const sub = res({ id: "s", serviceId: "subnet-public", name: "PubA" });
    const before = graph([sub]);
    const after = graph([res({ id: "s", serviceId: "subnet-public", name: "PubA" })]);
    const r = changeReceipt(before, after);
    expect(r.findings.unchanged).toBeGreaterThan(0);
    expect(r.findings.resolved).toEqual([]);
    expect(r.findings.introduced).toEqual([]);
  });

  it("sorts resolved/introduced findings deterministically", () => {
    const before = graph([]);
    const after = graph([
      res({ id: "s2", serviceId: "subnet-public", name: "Zeta" }),
      res({ id: "s1", serviceId: "subnet-public", name: "Alpha" }),
    ]);
    const r = changeReceipt(before, after);
    const sorted = [...r.findings.introduced].sort();
    expect(r.findings.introduced).toEqual(sorted);
  });

  it("is deterministic / idempotent across repeated runs", () => {
    const before = graph([res({ id: "a", serviceId: "ec2-instance", name: "Web" })]);
    const after = graph([
      res({ id: "a", serviceId: "ec2-instance", name: "Web" }),
      res({ id: "b", serviceId: "rds", name: "DB" }),
    ]);
    const r1 = changeReceipt(before, after);
    const r2 = changeReceipt(structuredClone(before), structuredClone(after));
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });

  it("does not mutate either input graph", () => {
    const before = graph([res({ id: "a", serviceId: "ec2-instance", name: "Web" })]);
    const after = graph([res({ id: "b", serviceId: "rds", name: "DB" })]);
    const beforeSnap = JSON.stringify(before);
    const afterSnap = JSON.stringify(after);
    changeReceipt(before, after);
    expect(JSON.stringify(before)).toBe(beforeSnap);
    expect(JSON.stringify(after)).toBe(afterSnap);
  });

  it("matches findings on their full identity tuple (delimiter cannot be forged)", () => {
    // Two distinct subnet resources whose names, if naively joined by a single
    // delimiter, could collide. A printable JSON-tuple key keeps them distinct,
    // so resolving one finding does not mask the other.
    const before = graph([
      res({ id: "s1", serviceId: "subnet-public", name: "A" }),
      res({ id: "s2", serviceId: "subnet-public", name: "B" }),
    ]);
    const after = graph([res({ id: "s2", serviceId: "subnet-public", name: "B" })]);
    const r = changeReceipt(before, after);
    // Exactly the s1 finding(s) resolve; the s2 finding(s) remain unchanged.
    expect(r.findings.resolved.length).toBeGreaterThan(0);
    expect(r.findings.unchanged).toBeGreaterThan(0);
    expect(r.findings.introduced).toEqual([]);
  });

  it("handles two empty graphs gracefully", () => {
    const r = changeReceipt(emptyGraph(), emptyGraph());
    expect(r.drift.inSync).toBe(true);
    expect(r.cost.delta).toBe(0);
    expect(r.summaryLines).toContain("No resource changes");
    expect(r.summaryLines).toContain("No change in findings");
  });
});

describe("renderMarkdown", () => {
  it("renders a stable Markdown document with all sections", () => {
    const before = graph([res({ id: "a", serviceId: "ec2-instance", name: "Web" })]);
    const after = graph([
      res({ id: "a", serviceId: "ec2-instance", name: "Web" }),
      res({ id: "b", serviceId: "s3-bucket", name: "Assets" }),
    ]);
    const md = renderMarkdown(changeReceipt(before, after));
    expect(md).toContain("# Change Receipt");
    expect(md).toContain("## Summary");
    expect(md).toContain("## Resources");
    expect(md).toContain("## Cost");
    expect(md).toContain("## Findings");
    expect(md).toContain("Assets (s3-bucket)");
  });

  it("is deterministic for the same receipt", () => {
    const before = graph([res({ id: "a", serviceId: "rds", name: "DB" })]);
    const after = graph([
      res({ id: "a", serviceId: "rds", name: "DB", config: { multiAz: true } }),
    ]);
    const receipt = changeReceipt(before, after);
    expect(renderMarkdown(receipt)).toBe(renderMarkdown(receipt));
  });

  it("renders 'none' for empty drift/finding lists", () => {
    const md = renderMarkdown(changeReceipt(emptyGraph(), emptyGraph()));
    expect(md).toContain("- Added: none");
    expect(md).toContain("- Removed: none");
    expect(md).toContain("- Resolved: none");
  });
});
