import { describe, it, expect } from "vitest";
import { detectFixes, applyFix, type Fixable } from "./autofix";
import { emptyGraph, type InfrastructureGraph, type ResourceInstance, type Relationship } from "./model";

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
      res({ id: "sg1", serviceId: "security-group", name: "web", config: { ingress: "tcp 22 0.0.0.0/0" } }),
    ]);
    const fixes = detectFixes(g);
    expect(fixes).toHaveLength(1);
    expect(fixes[0].kind).toBe("close-open-sg");
    expect(fixes[0].id).toBe("close-open-sg:sg1");
    expect(fixes[0].resourceId).toBe("sg1");
  });

  it("ignores non-sensitive ports (80/443) open to the world", () => {
    const g = graph([
      res({ id: "sg1", serviceId: "security-group", config: { ingress: "tcp 443 0.0.0.0/0\ntcp 80 0.0.0.0/0" } }),
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
    const g = graph([res({ id: "sg1", serviceId: "security-group", config: { ingress: "tcp 22 0.0.0.0/0" } })]);
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
