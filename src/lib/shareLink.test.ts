import { describe, it, expect } from "vitest";
import { encodeGraph, decodeGraph, buildShareUrl, readGraphFromHash } from "./shareLink";
import { emptyGraph, type InfrastructureGraph } from "../aws/model";

function sample(): InfrastructureGraph {
  const g = emptyGraph("Shared Net");
  g.resources = [
    { id: "vpc", serviceId: "vpc", name: "VPC", config: { cidr: "10.0.0.0/16" }, source: "manual" },
    {
      id: "ec2",
      serviceId: "ec2-instance",
      name: "Web",
      config: {},
      source: "manual",
      parentId: "vpc",
    },
  ];
  g.relationships = [{ id: "e1", from: "vpc", to: "ec2", kind: "contains" }];
  return g;
}

describe("shareLink", () => {
  it("round-trips a graph through encode → decode", () => {
    const g = sample();
    const decoded = decodeGraph(encodeGraph(g));
    expect(decoded).not.toBeNull();
    expect(decoded!.name).toBe("Shared Net");
    expect(decoded!.resources).toHaveLength(2);
    expect(decoded!.relationships[0].kind).toBe("contains");
  });

  it("survives unicode in names", () => {
    const g = sample();
    g.name = "Prod — café 🚀";
    expect(decodeGraph(encodeGraph(g))!.name).toBe("Prod — café 🚀");
  });

  it("builds a #g= URL the hash reader can parse back", () => {
    const url = buildShareUrl("https://strata.mk-dir.com/", sample());
    expect(url).toContain("#g=");
    const fromHash = readGraphFromHash(new URL(url).hash);
    expect(fromHash?.resources).toHaveLength(2);
  });

  it("returns null for garbage", () => {
    expect(decodeGraph("not-base64!!")).toBeNull();
    expect(readGraphFromHash("#nothing=here")).toBeNull();
  });
});
