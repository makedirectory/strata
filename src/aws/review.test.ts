import { describe, it, expect } from "vitest";
import { reviewAccount } from "./review";
import { detectFixes } from "./autofix";
import {
  emptyGraph,
  type InfrastructureGraph,
  type ResourceInstance,
  type Relationship,
} from "./model";

function res(
  over: Partial<ResourceInstance> & { id: string; serviceId: string },
): ResourceInstance {
  return { name: over.id, config: {}, source: "manual", ...over };
}
function graph(
  resources: ResourceInstance[],
  relationships: Relationship[] = [],
): InfrastructureGraph {
  return { ...emptyGraph(), resources, relationships };
}

describe("reviewAccount", () => {
  it("reports an empty, all-zero report for an empty graph", () => {
    const r = reviewAccount(emptyGraph());
    expect(r.resourceCount).toBe(0);
    expect(r.estimatedMonthly).toBe(0);
    expect(r.estimatedCount).toBe(0);
    expect(r.unknownCount).toBe(0);
    expect(r.tagCoverage).toEqual({ tagged: 0, untagged: 0, coverage: 0 });
    expect(r.orphanIds).toEqual([]);
    expect(r.findings).toEqual([]);
    expect(r.riskScore).toBe(0);
    expect(r.cleanup).toEqual([]);
  });

  it("carries cost map figures verbatim from cost.ts", () => {
    const g = graph([
      res({ id: "a", serviceId: "ec2-instance", config: { instanceType: "t3.micro" } }), // 8
      res({ id: "b", serviceId: "s3-bucket" }), // 5
    ]);
    const r = reviewAccount(g);
    expect(r.resourceCount).toBe(2);
    expect(r.estimatedMonthly).toBe(13);
    expect(r.estimatedCount).toBe(2);
    expect(r.unknownCount).toBe(0);
  });

  it("counts unknown-cost resources without hiding them", () => {
    // an unknown serviceId yields a null estimate -> unknownCount, and surfaces
    // an info-level cost finding.
    const g = graph([res({ id: "x", serviceId: "made-up-service" })]);
    const r = reviewAccount(g);
    expect(r.unknownCount).toBe(1);
    expect(r.estimatedCount).toBe(0);
    expect(r.findings.some((f) => f.category === "cost" && f.level === "info")).toBe(true);
  });

  it("computes tag coverage as the fraction with >=1 non-empty tag", () => {
    const g = graph([
      res({ id: "a", serviceId: "s3-bucket", tags: { env: "prod" } }),
      res({ id: "b", serviceId: "s3-bucket", tags: { env: "" } }), // empty -> untagged
      res({ id: "c", serviceId: "s3-bucket" }), // no tags
      res({ id: "d", serviceId: "s3-bucket", tags: { team: "core" } }),
    ]);
    const r = reviewAccount(g);
    expect(r.tagCoverage.tagged).toBe(2);
    expect(r.tagCoverage.untagged).toBe(2);
    expect(r.tagCoverage.coverage).toBeCloseTo(0.5, 5);
  });

  it("detects orphan/unconnected resources (no rel, no parent, no children)", () => {
    const g = graph(
      [
        res({ id: "vpc1", serviceId: "vpc" }),
        res({ id: "child", serviceId: "ec2-instance", parentId: "vpc1" }),
        res({ id: "lonely", serviceId: "s3-bucket" }),
      ],
      [],
    );
    const r = reviewAccount(g);
    // vpc1 has a child -> not orphan; child has parent -> not orphan; lonely is.
    expect(r.orphanIds).toEqual(["lonely"]);
  });

  it("does not treat a resource with a relationship as an orphan", () => {
    const g = graph(
      [res({ id: "a", serviceId: "s3-bucket" }), res({ id: "b", serviceId: "lambda" })],
      [{ id: "e1", from: "b", to: "a", kind: "reads_from" }],
    );
    const r = reviewAccount(g);
    expect(r.orphanIds).toEqual([]);
  });

  it("offers a safe-cleanup checklist of unconnected, non-container resources", () => {
    const g = graph([
      res({ id: "vol", serviceId: "ebs-volume", config: { sizeGiB: 100, volumeType: "gp3" } }), // 8/mo, unconnected
      res({ id: "vpc1", serviceId: "vpc" }), // container, unconnected -> excluded
      res({ id: "free", serviceId: "security-group" }), // 0/mo, unconnected
    ]);
    const r = reviewAccount(g);
    const ids = r.cleanup.map((c) => c.resourceId);
    expect(ids).toContain("vol");
    expect(ids).toContain("free");
    expect(ids).not.toContain("vpc1"); // container excluded
    // sorted by reclaimable spend desc: ebs (8) before security-group (0)
    expect(ids.indexOf("vol")).toBeLessThan(ids.indexOf("free"));
    const vol = r.cleanup.find((c) => c.resourceId === "vol");
    expect(vol?.monthlyCost).toBe(8);
    expect(vol?.name).toBe("vol"); // candidate.name is the resource's own name
    expect(vol?.reason).toContain("EBS"); // service name resolved via registry into the reason
  });

  it("labels unknown-cost cleanup candidates as unknown, not free", () => {
    // An unconnected, non-container resource whose serviceId has no cost model
    // yields a null estimate. The reason must flag this as UNKNOWN/verify rather
    // than implying it is free/safe to delete.
    const g = graph([res({ id: "mystery", serviceId: "made-up-service", name: "Mystery" })]);
    const r = reviewAccount(g);
    const candidate = r.cleanup.find((c) => c.resourceId === "mystery");
    expect(candidate).toBeDefined();
    expect(candidate?.monthlyCost).toBe(0); // numeric coercion is fine...
    // ...but the reason must not claim the cost is known/free.
    expect(candidate?.reason).not.toContain("no known recurring cost");
    expect(candidate?.reason).toMatch(/unknown/i);
    expect(candidate?.reason).toMatch(/verify/i);
  });

  it("scores risk deterministically (error=3, warn=1, info=0)", () => {
    // a public subnet with no route to an IGW -> rules.ts emits an error.
    const g = graph([res({ id: "sn", serviceId: "subnet-public", name: "Public" })]);
    const r = reviewAccount(g);
    const errors = r.findings.filter((f) => f.level === "error");
    const warns = r.findings.filter((f) => f.level === "warn");
    expect(errors.length).toBeGreaterThan(0);
    expect(r.riskScore).toBe(errors.length * 3 + warns.length * 1);
  });

  it("maps rules levels and never emits an 'ok' level finding", () => {
    const g = graph([res({ id: "sn", serviceId: "subnet-public", name: "Public" })]);
    const r = reviewAccount(g);
    for (const f of r.findings) {
      expect(["error", "warn", "info"]).toContain(f.level);
    }
  });

  it("is deterministic / idempotent across repeated runs", () => {
    const build = (): InfrastructureGraph =>
      graph(
        [
          res({ id: "vol", serviceId: "ebs-volume", config: { sizeGiB: 50, volumeType: "gp3" } }),
          res({ id: "bkt", serviceId: "s3-bucket", tags: { env: "prod" } }),
          res({ id: "sn", serviceId: "subnet-public", name: "Public" }),
        ],
        [],
      );
    const a = reviewAccount(build());
    const b = reviewAccount(build());
    expect(a).toEqual(b);
    // finding ids are unique and stable
    const ids = a.findings.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("sorts findings by level then resourceId deterministically", () => {
    const g = graph([
      res({ id: "z", serviceId: "subnet-public", name: "Z" }), // error
      res({ id: "a", serviceId: "subnet-public", name: "A" }), // error
    ]);
    const r = reviewAccount(g);
    const errorResIds = r.findings
      .filter((f) => f.level === "error" && f.resourceId)
      .map((f) => f.resourceId as string);
    const sorted = [...errorResIds].sort();
    expect(errorResIds).toEqual(sorted);
  });
});

describe("reviewAccount — finding↔autofix links", () => {
  // Two-AZ single-NAT graph that triggers the add-nat-per-az reliability finding.
  function twoAzGraph(): InfrastructureGraph {
    return graph(
      [
        res({ id: "vpc", serviceId: "vpc" }),
        res({ id: "pub-a", serviceId: "subnet-public", parentId: "vpc", config: { az: "az-a" } }),
        res({ id: "pub-b", serviceId: "subnet-public", parentId: "vpc", config: { az: "az-b" } }),
        res({ id: "priv-a", serviceId: "subnet-private", parentId: "vpc", config: { az: "az-a" } }),
        res({ id: "priv-b", serviceId: "subnet-private", parentId: "vpc", config: { az: "az-b" } }),
        res({ id: "nat-a", serviceId: "nat-gateway", parentId: "pub-a", config: { az: "az-a" } }),
        res({ id: "rt-b", serviceId: "route-table" }),
      ],
      [{ id: "rt-b-attach", from: "rt-b", to: "priv-b", kind: "attached_to" }],
    );
  }

  // Each case: a graph that triggers exactly one fixable finding, the distinctive
  // substring of that finding, and the fix-id prefix the link must point at.
  const cases: { name: string; g: () => InfrastructureGraph; msg: string; fixPrefix: string }[] = [
    {
      name: "close-open-sg",
      g: () =>
        graph([
          res({ id: "sg1", serviceId: "security-group", config: { ingress: "tcp 22 0.0.0.0/0" } }),
        ]),
      msg: "exposes sensitive port",
      fixPrefix: "close-open-sg:",
    },
    {
      name: "enable-storage-encryption",
      g: () => graph([res({ id: "ebs1", serviceId: "ebs-volume", config: { encrypted: false } })]),
      msg: "stores data at rest unencrypted",
      fixPrefix: "enable-storage-encryption:",
    },
    {
      name: "add-igw-default-route",
      g: () =>
        graph(
          [
            res({ id: "sn1", serviceId: "subnet-public", name: "Public A" }),
            res({ id: "rt1", serviceId: "route-table" }),
            res({ id: "igw1", serviceId: "internet-gateway" }),
          ],
          [{ id: "e1", from: "rt1", to: "sn1", kind: "attached_to" }],
        ),
      msg: "routes to an Internet Gateway",
      fixPrefix: "add-igw-default-route:",
    },
    {
      name: "move-nat-to-public-subnet",
      g: () =>
        graph([
          res({ id: "nat1", serviceId: "nat-gateway" }),
          res({ id: "pub1", serviceId: "subnet-public" }),
        ]),
      msg: "should be placed in a public Subnet",
      fixPrefix: "move-nat-to-public-subnet:",
    },
    {
      name: "add-nat-per-az",
      g: twoAzGraph,
      msg: "serves private subnets across",
      fixPrefix: "add-nat-per-az:",
    },
    {
      name: "secure-config-flag (S3 block public access)",
      g: () =>
        graph([res({ id: "b1", serviceId: "s3-bucket", config: { blockPublicAccess: false } })]),
      msg: "Block Public Access disabled",
      fixPrefix: "secure-config-flag:blockPublicAccess:",
    },
    {
      name: "secure-config-flag (RDS public)",
      g: () => graph([res({ id: "db1", serviceId: "rds", config: { publiclyAccessible: true } })]),
      msg: "must not be publicly accessible",
      fixPrefix: "secure-config-flag:publiclyAccessible:",
    },
    {
      name: "secure-config-flag (GCS uniform access)",
      g: () =>
        graph([
          res({
            id: "g1",
            serviceId: "gcp-cloud-storage",
            config: { uniformBucketLevelAccess: false },
          }),
        ]),
      msg: "uniform bucket-level access disabled",
      fixPrefix: "secure-config-flag:uniformBucketLevelAccess:",
    },
    {
      name: "secure-config-flag (Azure blob public)",
      g: () =>
        graph([
          res({
            id: "sa1",
            serviceId: "azure-storage-account",
            config: { allowPublicAccess: true },
          }),
        ]),
      msg: "public blob access enabled",
      fixPrefix: "secure-config-flag:allowPublicAccess:",
    },
    {
      name: "secure-config-flag (Azure Redis non-SSL)",
      g: () =>
        graph([res({ id: "rc1", serviceId: "azure-redis", config: { enableNonSslPort: true } })]),
      msg: "non-SSL port enabled",
      fixPrefix: "secure-config-flag:enableNonSslPort:",
    },
  ];

  for (const c of cases) {
    it(`links the ${c.name} finding to its fix`, () => {
      const g = c.g();
      const review = reviewAccount(g);
      const f = review.findings.find((x) => x.message.includes(c.msg));
      expect(f, `expected a finding matching "${c.msg}"`).toBeDefined();
      expect(f?.fixId).toBeDefined();
      expect(f?.fixId?.startsWith(c.fixPrefix)).toBe(true);
      // The linked fix id must be a real, currently-detectable fix.
      expect(detectFixes(g).map((x) => x.id)).toContain(f?.fixId);
    });
  }

  it("leaves non-fixable findings without a fixId, and never invents fix ids", () => {
    const g = twoAzGraph();
    const review = reviewAccount(g);
    const fixIds = new Set(detectFixes(g).map((x) => x.id));
    for (const f of review.findings) {
      if (f.fixId !== undefined) expect(fixIds.has(f.fixId)).toBe(true);
    }
    // The untagged-resources hygiene finding is informational — never fixable.
    const untagged = review.findings.find((f) => f.message.includes("untagged"));
    expect(untagged?.fixId).toBeUndefined();
  });

  it("assigns each fix to at most one finding", () => {
    const g = twoAzGraph();
    const linked = reviewAccount(g)
      .findings.map((f) => f.fixId)
      .filter((id): id is string => !!id);
    expect(linked.length).toBe(new Set(linked).size);
  });
});
