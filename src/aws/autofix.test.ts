import { describe, it, expect } from "vitest";
import { detectFixes, applyFix, type Fixable } from "./autofix";
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
function rel(over: Partial<Relationship> & { id: string; from: string; to: string }): Relationship {
  return { kind: "attached_to", ...over };
}
function graph(
  resources: ResourceInstance[],
  relationships: Relationship[] = [],
): InfrastructureGraph {
  return { ...emptyGraph(), resources, relationships };
}

/** Snapshot a graph as JSON to assert the input was not mutated. */
function snap(g: InfrastructureGraph): string {
  return JSON.stringify(g);
}

describe("detectFixes — close-open-sg", () => {
  it("detects a sensitive port open to the world", () => {
    const g = graph([
      res({
        id: "sg1",
        serviceId: "security-group",
        name: "web",
        config: { ingress: "tcp 22 0.0.0.0/0" },
      }),
    ]);
    const fixes = detectFixes(g);
    expect(fixes).toHaveLength(1);
    expect(fixes[0].kind).toBe("close-open-sg");
    expect(fixes[0].id).toBe("close-open-sg:sg1");
    expect(fixes[0].resourceId).toBe("sg1");
  });

  it("ignores non-sensitive ports (80/443) open to the world", () => {
    const g = graph([
      res({
        id: "sg1",
        serviceId: "security-group",
        config: { ingress: "tcp 443 0.0.0.0/0\ntcp 80 0.0.0.0/0" },
      }),
    ]);
    expect(detectFixes(g)).toHaveLength(0);
  });

  it("ignores a sensitive port restricted to a private CIDR", () => {
    const g = graph([
      res({ id: "sg1", serviceId: "security-group", config: { ingress: "tcp 22 10.0.0.0/8" } }),
    ]);
    expect(detectFixes(g)).toHaveLength(0);
  });

  it("detects a sensitive port inside a range and ::/0 IPv6 world", () => {
    const g = graph([
      res({ id: "sg1", serviceId: "security-group", config: { ingress: "tcp 20-25 ::/0" } }),
    ]);
    expect(detectFixes(g)).toHaveLength(1);
  });
});

describe("applyFix — close-open-sg", () => {
  it("rewrites only the offending line's CIDR and leaves others intact", () => {
    const g = graph([
      res({
        id: "sg1",
        serviceId: "security-group",
        config: { ingress: "tcp 443 0.0.0.0/0\ntcp 22 0.0.0.0/0" },
      }),
    ]);
    const before = snap(g);
    const next = applyFix(g, "close-open-sg:sg1");
    expect(next).not.toBe(g);
    expect(snap(g)).toBe(before); // input untouched
    const ingress = next.resources[0].config["ingress"] as string;
    expect(ingress).toBe("tcp 443 0.0.0.0/0\ntcp 22 10.0.0.0/8");
    // Idempotent: applying again detects nothing.
    expect(detectFixes(next)).toHaveLength(0);
  });
});

describe("detect/apply — enable-storage-encryption", () => {
  it("detects explicit unencrypted flags across services and enables them", () => {
    const g = graph([
      res({ id: "ebs1", serviceId: "ebs-volume", config: { encrypted: false } }),
      res({ id: "rds1", serviceId: "rds", config: { storageEncrypted: false } }),
      res({ id: "efs1", serviceId: "efs", config: { encrypted: true } }), // already on
    ]);
    const fixes = detectFixes(g);
    expect(fixes.map((f) => f.resourceId).sort()).toEqual(["ebs1", "rds1"]);

    const next = applyFix(g, "enable-storage-encryption:ebs1");
    expect(next.resources.find((r) => r.id === "ebs1")!.config["encrypted"]).toBe(true);
    // Untouched resource unchanged.
    expect(next.resources.find((r) => r.id === "rds1")!.config["storageEncrypted"]).toBe(false);
    // Idempotent for that resource.
    expect(detectFixes(next).map((f) => f.resourceId)).toEqual(["rds1"]);
  });

  it("does not fire when the flag is absent (unknown defaults are not findings)", () => {
    const g = graph([res({ id: "ebs1", serviceId: "ebs-volume", config: {} })]);
    expect(detectFixes(g)).toHaveLength(0);
  });
});

describe("detect/apply — add-igw-default-route", () => {
  it("detects a public subnet RT without an IGW default route and adds one", () => {
    const g = graph(
      [
        res({ id: "sn1", serviceId: "subnet-public", name: "Public A" }),
        res({ id: "rt1", serviceId: "route-table", name: "RT" }),
        res({ id: "igw1", serviceId: "internet-gateway", name: "IGW" }),
      ],
      [rel({ id: "e1", from: "rt1", to: "sn1", kind: "attached_to" })],
    );
    const fixes = detectFixes(g);
    expect(fixes).toHaveLength(1);
    expect(fixes[0].kind).toBe("add-igw-default-route");
    expect(fixes[0].resourceId).toBe("rt1");

    const before = snap(g);
    const next = applyFix(g, fixes[0].id);
    expect(snap(g)).toBe(before);
    const added = next.relationships.find((e) => e.kind === "routes_to");
    expect(added).toBeDefined();
    expect(added!.from).toBe("rt1");
    expect(added!.to).toBe("igw1");
    expect(added!.destinationCidr).toBe("0.0.0.0/0");
    // Idempotent.
    expect(detectFixes(next)).toHaveLength(0);
  });

  it("does not fire when no internet gateway exists", () => {
    const g = graph(
      [
        res({ id: "sn1", serviceId: "subnet-public" }),
        res({ id: "rt1", serviceId: "route-table" }),
      ],
      [rel({ id: "e1", from: "rt1", to: "sn1", kind: "attached_to" })],
    );
    expect(detectFixes(g)).toHaveLength(0);
  });

  it("emits exactly ONE fix when two public subnets share one route table", () => {
    // BUG 3: per-subnet iteration pushed a duplicate `add-igw-default-route:rt1`
    // for each public subnet backed by the same route table.
    const g = graph(
      [
        res({ id: "snA", serviceId: "subnet-public", name: "Public A" }),
        res({ id: "snB", serviceId: "subnet-public", name: "Public B" }),
        res({ id: "rt1", serviceId: "route-table", name: "RT" }),
        res({ id: "igw1", serviceId: "internet-gateway", name: "IGW" }),
      ],
      [
        rel({ id: "e1", from: "rt1", to: "snA", kind: "attached_to" }),
        rel({ id: "e2", from: "rt1", to: "snB", kind: "attached_to" }),
      ],
    );
    const fixes = detectFixes(g).filter((f) => f.kind === "add-igw-default-route");
    expect(fixes).toHaveLength(1);
    expect(fixes[0].id).toBe("add-igw-default-route:rt1");
  });

  it("binds the route to the IGW in the SAME VPC (multi-VPC)", () => {
    // BUG 4: cross-VPC selection used the first IGW globally. Each VPC's route
    // table must route to its own IGW.
    const g = graph(
      [
        res({ id: "vpcA", serviceId: "vpc", name: "VPC A" }),
        res({ id: "snA", serviceId: "subnet-public", name: "Pub A", parentId: "vpcA" }),
        res({ id: "rtA", serviceId: "route-table", name: "RT A" }),
        res({ id: "igwA", serviceId: "internet-gateway", name: "IGW A" }),
        res({ id: "vpcB", serviceId: "vpc", name: "VPC B" }),
        res({ id: "snB", serviceId: "subnet-public", name: "Pub B", parentId: "vpcB" }),
        res({ id: "rtB", serviceId: "route-table", name: "RT B" }),
        res({ id: "igwB", serviceId: "internet-gateway", name: "IGW B" }),
      ],
      [
        rel({ id: "ea", from: "rtA", to: "snA", kind: "attached_to" }),
        rel({ id: "eb", from: "rtB", to: "snB", kind: "attached_to" }),
        rel({ id: "ga", from: "igwA", to: "vpcA", kind: "attached_to" }),
        rel({ id: "gb", from: "igwB", to: "vpcB", kind: "attached_to" }),
      ],
    );
    const fixA = detectFixes(g).find((f) => f.resourceId === "rtA")!;
    const fixB = detectFixes(g).find((f) => f.resourceId === "rtB")!;
    expect(fixA.detail).toContain("IGW A");
    expect(fixB.detail).toContain("IGW B");

    const nextA = applyFix(g, fixA.id);
    const addedA = nextA.relationships.find((e) => e.kind === "routes_to" && e.from === "rtA")!;
    expect(addedA.to).toBe("igwA");
    const nextB = applyFix(g, fixB.id);
    const addedB = nextB.relationships.find((e) => e.kind === "routes_to" && e.from === "rtB")!;
    expect(addedB.to).toBe("igwB");
  });

  it("emits the assumption note on a cross-VPC fallback (RT's VPC has no IGW)", () => {
    // BUG 2: when the RT's VPC IS resolved but has no IGW, the chosen IGW lives
    // in a DIFFERENT VPC — yet the assumption note was suppressed because
    // `scoped` was derived from vpcOf(rt) truthiness. The note must now fire,
    // and the route binds to the only available IGW.
    const g = graph(
      [
        res({ id: "vpcA", serviceId: "vpc", name: "VPC A" }),
        res({ id: "snA", serviceId: "subnet-public", name: "Pub A", parentId: "vpcA" }),
        res({ id: "rtA", serviceId: "route-table", name: "RT A" }),
        res({ id: "igwA", serviceId: "internet-gateway", name: "IGW A" }),
        res({ id: "vpcB", serviceId: "vpc", name: "VPC B" }),
        res({ id: "snB", serviceId: "subnet-public", name: "Pub B", parentId: "vpcB" }),
        res({ id: "rtB", serviceId: "route-table", name: "RT B" }),
      ],
      [
        rel({ id: "ea", from: "rtA", to: "snA", kind: "attached_to" }),
        rel({ id: "eb", from: "rtB", to: "snB", kind: "attached_to" }),
        rel({ id: "ga", from: "igwA", to: "vpcA", kind: "attached_to" }),
      ],
    );
    const fixB = detectFixes(g).find((f) => f.resourceId === "rtB")!;
    expect(fixB).toBeDefined();
    // The only IGW lives in VPC A — a cross-VPC fallback — so the note fires.
    expect(fixB.detail).toContain("first available Internet Gateway is assumed");
    expect(fixB.detail).toContain("IGW A");

    const nextB = applyFix(g, fixB.id);
    const addedB = nextB.relationships.find((e) => e.kind === "routes_to" && e.from === "rtB")!;
    expect(addedB.to).toBe("igwA");

    // VPC A's own route table still binds same-VPC with NO assumption note.
    const fixA = detectFixes(g).find((f) => f.resourceId === "rtA")!;
    expect(fixA.detail).not.toContain("first available Internet Gateway is assumed");
    expect(fixA.detail).toContain("IGW A");
  });

  it("does not fire when the default route already exists", () => {
    const g = graph(
      [
        res({ id: "sn1", serviceId: "subnet-public" }),
        res({ id: "rt1", serviceId: "route-table" }),
        res({ id: "igw1", serviceId: "internet-gateway" }),
      ],
      [
        rel({ id: "e1", from: "rt1", to: "sn1", kind: "attached_to" }),
        rel({ id: "e2", from: "rt1", to: "igw1", kind: "routes_to", destinationCidr: "0.0.0.0/0" }),
      ],
    );
    expect(detectFixes(g)).toHaveLength(0);
  });
});

describe("detect/apply — move-nat-to-public-subnet", () => {
  it("detects a NAT in a private subnet and repoints it to a public subnet", () => {
    const g = graph([
      res({ id: "pub", serviceId: "subnet-public", name: "Public" }),
      res({ id: "priv", serviceId: "subnet-private", name: "Private" }),
      res({ id: "nat1", serviceId: "nat-gateway", name: "NAT", parentId: "priv" }),
    ]);
    const fixes = detectFixes(g);
    expect(fixes).toHaveLength(1);
    expect(fixes[0].kind).toBe("move-nat-to-public-subnet");

    const before = snap(g);
    const next = applyFix(g, fixes[0].id);
    expect(snap(g)).toBe(before);
    expect(next.resources.find((r) => r.id === "nat1")!.parentId).toBe("pub");
    expect(detectFixes(next)).toHaveLength(0);
  });

  it("drops a stale subnet attachment edge when repointing", () => {
    const g = graph(
      [
        res({ id: "pub", serviceId: "subnet-public" }),
        res({ id: "priv", serviceId: "subnet-private" }),
        res({ id: "nat1", serviceId: "nat-gateway" }),
      ],
      [rel({ id: "e1", from: "nat1", to: "priv", kind: "attached_to" })],
    );
    const next = applyFix(g, "move-nat-to-public-subnet:nat1");
    expect(next.relationships.some((e) => e.to === "priv" && e.from === "nat1")).toBe(false);
    expect(next.resources.find((r) => r.id === "nat1")!.parentId).toBe("pub");
    expect(detectFixes(next)).toHaveLength(0);
  });

  it("repoints the NAT to a public subnet in the SAME VPC (multi-VPC)", () => {
    // BUG 4: cross-VPC selection used the first public subnet globally. The NAT
    // must move into a public subnet within its own VPC.
    const g = graph([
      res({ id: "vpcA", serviceId: "vpc", name: "VPC A" }),
      res({ id: "pubA", serviceId: "subnet-public", name: "Pub A", parentId: "vpcA" }),
      res({ id: "privA", serviceId: "subnet-private", name: "Priv A", parentId: "vpcA" }),
      res({ id: "natA", serviceId: "nat-gateway", name: "NAT A", parentId: "privA" }),
      res({ id: "vpcB", serviceId: "vpc", name: "VPC B" }),
      res({ id: "pubB", serviceId: "subnet-public", name: "Pub B", parentId: "vpcB" }),
      res({ id: "privB", serviceId: "subnet-private", name: "Priv B", parentId: "vpcB" }),
      res({ id: "natB", serviceId: "nat-gateway", name: "NAT B", parentId: "privB" }),
    ]);
    const nextA = applyFix(g, "move-nat-to-public-subnet:natA");
    expect(nextA.resources.find((r) => r.id === "natA")!.parentId).toBe("pubA");
    const nextB = applyFix(g, "move-nat-to-public-subnet:natB");
    expect(nextB.resources.find((r) => r.id === "natB")!.parentId).toBe("pubB");
  });

  it("does not fire when the NAT is already in a public subnet", () => {
    const g = graph([
      res({ id: "pub", serviceId: "subnet-public" }),
      res({ id: "nat1", serviceId: "nat-gateway", parentId: "pub" }),
    ]);
    expect(detectFixes(g)).toHaveLength(0);
  });

  it("does not fire when there is no public subnet to move into", () => {
    const g = graph([
      res({ id: "priv", serviceId: "subnet-private" }),
      res({ id: "nat1", serviceId: "nat-gateway", parentId: "priv" }),
    ]);
    expect(detectFixes(g)).toHaveLength(0);
  });
});

describe("applyFix — safety / no-op", () => {
  it("returns the same graph reference for an unknown fixId", () => {
    const g = graph([
      res({ id: "sg1", serviceId: "security-group", config: { ingress: "tcp 22 0.0.0.0/0" } }),
    ]);
    expect(applyFix(g, "nope:does-not-exist")).toBe(g);
  });

  it("never mutates input across all fix kinds", () => {
    const g = graph(
      [
        res({ id: "sg1", serviceId: "security-group", config: { ingress: "tcp 22 0.0.0.0/0" } }),
        res({ id: "ebs1", serviceId: "ebs-volume", config: { encrypted: false } }),
        res({ id: "pub", serviceId: "subnet-public" }),
        res({ id: "rt1", serviceId: "route-table" }),
        res({ id: "igw1", serviceId: "internet-gateway" }),
        res({ id: "priv", serviceId: "subnet-private" }),
        res({ id: "nat1", serviceId: "nat-gateway", parentId: "priv" }),
      ],
      [rel({ id: "e1", from: "rt1", to: "pub", kind: "attached_to" })],
    );
    const before = snap(g);
    for (const f of detectFixes(g)) {
      applyFix(g, f.id);
    }
    expect(snap(g)).toBe(before);
  });

  it("deep-copies annotations so the returned graph is isolated from the input", () => {
    const g: InfrastructureGraph = {
      ...graph([
        res({ id: "sg1", serviceId: "security-group", config: { ingress: "tcp 22 0.0.0.0/0" } }),
      ]),
      annotations: [{ id: "a1", kind: "note", text: "original", x: 0, y: 0 }],
    };
    const fix = detectFixes(g).find((f) => f.kind === "close-open-sg")!;
    const next = applyFix(g, fix.id);

    // The annotations array and its objects must not be the same references.
    expect(next.annotations).not.toBe(g.annotations);
    expect(next.annotations![0]).not.toBe(g.annotations![0]);

    // Mutating the returned graph's annotation does NOT affect the input.
    next.annotations![0].text = "mutated-in-next";
    expect(g.annotations![0].text).toBe("original");

    // ...and mutating the input's annotation does NOT affect the returned graph.
    g.annotations![0].text = "mutated-in-input";
    expect(next.annotations![0].text).toBe("mutated-in-next");
  });
});

describe("detectFixes — determinism + ordering", () => {
  it("returns fixes grouped by kind in declaration order, then resourceId", () => {
    const g = graph(
      [
        res({ id: "nat1", serviceId: "nat-gateway", parentId: "priv" }),
        res({ id: "priv", serviceId: "subnet-private" }),
        res({ id: "pub", serviceId: "subnet-public" }),
        res({ id: "rt1", serviceId: "route-table" }),
        res({ id: "igw1", serviceId: "internet-gateway" }),
        res({ id: "sgB", serviceId: "security-group", config: { ingress: "tcp 22 0.0.0.0/0" } }),
        res({ id: "sgA", serviceId: "security-group", config: { ingress: "tcp 3389 0.0.0.0/0" } }),
        res({ id: "ebs1", serviceId: "ebs-volume", config: { encrypted: false } }),
      ],
      [rel({ id: "e1", from: "rt1", to: "pub", kind: "attached_to" })],
    );
    const kinds = detectFixes(g).map((f) => f.kind);
    // close-open-sg (sgA, sgB) then add-igw-default-route then encryption then nat.
    expect(kinds).toEqual([
      "close-open-sg",
      "close-open-sg",
      "add-igw-default-route",
      "enable-storage-encryption",
      "move-nat-to-public-subnet",
    ]);
    const sgIds = detectFixes(g)
      .filter((f: Fixable) => f.kind === "close-open-sg")
      .map((f) => f.resourceId);
    expect(sgIds).toEqual(["sgA", "sgB"]); // resourceId-sorted
  });
});

describe("detectFixes/applyFix — secure-config-flag", () => {
  const cases: { serviceId: string; key: string; insecure: boolean; secure: boolean }[] = [
    { serviceId: "s3-bucket", key: "blockPublicAccess", insecure: false, secure: true },
    { serviceId: "rds", key: "publiclyAccessible", insecure: true, secure: false },
    {
      serviceId: "gcp-cloud-storage",
      key: "uniformBucketLevelAccess",
      insecure: false,
      secure: true,
    },
    { serviceId: "azure-storage-account", key: "allowPublicAccess", insecure: true, secure: false },
    { serviceId: "azure-redis", key: "enableNonSslPort", insecure: true, secure: false },
  ];

  for (const c of cases) {
    it(`detects and fixes ${c.serviceId}.${c.key}`, () => {
      const g = graph([res({ id: "r1", serviceId: c.serviceId, config: { [c.key]: c.insecure } })]);
      const before = snap(g);
      const fixes = detectFixes(g).filter((f) => f.kind === "secure-config-flag");
      expect(fixes).toHaveLength(1);
      expect(fixes[0].id).toBe(`secure-config-flag:${c.key}:r1`);

      const out = applyFix(g, fixes[0].id);
      expect(out.resources[0].config[c.key]).toBe(c.secure);
      expect(detectFixes(out).filter((f) => f.kind === "secure-config-flag")).toHaveLength(0);
      expect(snap(g)).toBe(before); // input untouched
    });
  }

  it("does not flag a flag already in its secure state", () => {
    const g = graph([
      res({ id: "b", serviceId: "s3-bucket", config: { blockPublicAccess: true } }),
    ]);
    expect(detectFixes(g).filter((f) => f.kind === "secure-config-flag")).toHaveLength(0);
  });

  it("does not flag when the flag is unset (defaults are secure)", () => {
    const g = graph([res({ id: "b", serviceId: "s3-bucket", config: {} })]);
    expect(detectFixes(g).filter((f) => f.kind === "secure-config-flag")).toHaveLength(0);
  });
});

describe("detectFixes/applyFix — add-nat-per-az", () => {
  // One VPC, one NAT in az-a's public subnet, private subnets in az-a and az-b,
  // a public subnet in az-b to host a new NAT, and a route table for az-b's
  // private subnet.
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
      [rel({ id: "rt-b-attach", from: "rt-b", to: "priv-b", kind: "attached_to" })],
    );
  }

  it("offers the fix when one NAT serves private subnets across 2 AZs", () => {
    const g = twoAzGraph();
    const fixes = detectFixes(g).filter((f) => f.kind === "add-nat-per-az");
    expect(fixes).toHaveLength(1);
    expect(fixes[0].id).toBe("add-nat-per-az:nat-a");
    expect(fixes[0].detail).toContain("az-b");
  });

  it("creates a NAT in the missing AZ's public subnet and routes its private subnets", () => {
    const g = twoAzGraph();
    const before = snap(g);
    const out = applyFix(g, "add-nat-per-az:nat-a");

    const newNat = out.resources.find((r) => r.id === "autofix-nat-az-b");
    expect(newNat).toBeDefined();
    expect(newNat?.serviceId).toBe("nat-gateway");
    expect(newNat?.parentId).toBe("pub-b"); // placed in az-b's public subnet
    expect(newNat?.config.az).toBe("az-b");

    const route = out.relationships.find((e) => e.to === "autofix-nat-az-b" && e.from === "rt-b");
    expect(route?.kind).toBe("routes_to");
    expect(route?.destinationCidr).toBe("0.0.0.0/0");

    expect(snap(g)).toBe(before); // input untouched
    // Idempotent: a second NAT now exists, so the fix is no longer offered.
    expect(detectFixes(out).filter((f) => f.kind === "add-nat-per-az")).toHaveLength(0);
  });

  it("is not offered when the missing AZ has no public subnet to host a NAT", () => {
    const g = graph([
      res({ id: "vpc", serviceId: "vpc" }),
      res({ id: "pub-a", serviceId: "subnet-public", parentId: "vpc", config: { az: "az-a" } }),
      res({ id: "priv-a", serviceId: "subnet-private", parentId: "vpc", config: { az: "az-a" } }),
      res({ id: "priv-b", serviceId: "subnet-private", parentId: "vpc", config: { az: "az-b" } }),
      res({ id: "nat-a", serviceId: "nat-gateway", parentId: "pub-a", config: { az: "az-a" } }),
    ]);
    expect(detectFixes(g).filter((f) => f.kind === "add-nat-per-az")).toHaveLength(0);
  });

  it("is not offered when more than one NAT already exists", () => {
    const g = twoAzGraph();
    g.resources.push(
      res({ id: "nat-b", serviceId: "nat-gateway", parentId: "pub-b", config: { az: "az-b" } }),
    );
    expect(detectFixes(g).filter((f) => f.kind === "add-nat-per-az")).toHaveLength(0);
  });
});
