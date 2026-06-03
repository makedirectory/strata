import { describe, it, expect } from "vitest";
import {
  encodeGraph,
  decodeGraph,
  buildShareUrl,
  readGraphFromHash,
  isShareUrlTooLong,
  MAX_SHARE_URL_LENGTH,
} from "./shareLink";
import { emptyGraph, type InfrastructureGraph } from "../aws/model";
import type { Annotation } from "../aws/annotations";

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

  it("round-trips the annotation layer (and drops malformed entries on decode)", () => {
    const g = sample() as InfrastructureGraph & { annotations?: Annotation[] };
    g.annotations = [
      { id: "n1", kind: "note", text: "hello", x: 10, y: 20 },
      { id: "z1", kind: "zone", text: "Public tier", x: 0, y: 0, w: 400, h: 200, color: "#345" },
      { id: "c1", kind: "callout", text: "see this", x: 50, y: 50, targetId: "ec2" },
    ];
    const decoded = decodeGraph(encodeGraph(g));
    expect(decoded).not.toBeNull();
    expect(decoded!.annotations).toHaveLength(3);
    expect(decoded!.annotations![0]).toMatchObject({ id: "n1", kind: "note", text: "hello" });
    expect(decoded!.annotations![1]).toMatchObject({ kind: "zone", w: 400, h: 200 });
    expect(decoded!.annotations![2]).toMatchObject({ kind: "callout", targetId: "ec2" });
  });

  it("drops malformed annotations from a tampered payload, keeping well-formed ones", () => {
    const g = sample() as InfrastructureGraph & { annotations?: Annotation[] };
    // Mix a valid annotation with malformed ones (bad kind, missing coords, wrong type).
    const tampered = [
      { id: "ok", kind: "note", text: "valid", x: 1, y: 2 },
      { id: "bad-kind", kind: "scribble", text: "x", x: 0, y: 0 },
      { id: "no-coords", kind: "note", text: "x" },
      "not-an-object",
    ];
    (g as { annotations?: unknown }).annotations = tampered;
    const decoded = decodeGraph(encodeGraph(g as InfrastructureGraph));
    expect(decoded).not.toBeNull();
    expect(decoded!.annotations).toHaveLength(1);
    expect(decoded!.annotations![0].id).toBe("ok");
  });

  it("strips an unsafe annotation color on decode but keeps the annotation", () => {
    // BUG 4: the color is injected into a CSS custom property / SVG stroke, so a
    // style-injection payload must be dropped — without discarding the whole
    // annotation. Safe colors (#hex / var() / rgb() / named) are preserved.
    const g = sample() as InfrastructureGraph & { annotations?: Annotation[] };
    (g as { annotations?: unknown }).annotations = [
      { id: "evil", kind: "note", text: "x", x: 0, y: 0, color: "red; background:url(x)" },
      { id: "hex", kind: "note", text: "x", x: 0, y: 0, color: "#34d399" },
      { id: "var", kind: "note", text: "x", x: 0, y: 0, color: "var(--x)" },
      { id: "rgb", kind: "note", text: "x", x: 0, y: 0, color: "rgb(1,2,3)" },
      { id: "named", kind: "note", text: "x", x: 0, y: 0, color: "tomato" },
    ];
    const decoded = decodeGraph(encodeGraph(g as InfrastructureGraph));
    expect(decoded).not.toBeNull();
    const byId = new Map(decoded!.annotations!.map((a) => [a.id, a]));
    // The unsafe one survives but loses its color.
    expect(byId.get("evil")).toMatchObject({ id: "evil", kind: "note", text: "x" });
    expect(byId.get("evil")!.color).toBeUndefined();
    // Safe colors are kept verbatim.
    expect(byId.get("hex")!.color).toBe("#34d399");
    expect(byId.get("var")!.color).toBe("var(--x)");
    expect(byId.get("rgb")!.color).toBe("rgb(1,2,3)");
    expect(byId.get("named")!.color).toBe("tomato");
  });

  it("omits the annotations field entirely when the graph has none", () => {
    const decoded = decodeGraph(encodeGraph(sample()));
    expect(decoded).not.toBeNull();
    expect(decoded!.annotations).toBeUndefined();
  });

  it("keeps a normal diagram's share URL under the size budget", () => {
    const url = buildShareUrl("https://strata.mk-dir.com/", sample());
    expect(url.length).toBeLessThanOrEqual(MAX_SHARE_URL_LENGTH);
    expect(isShareUrlTooLong(url)).toBe(false);
  });

  it("flags a diagram padded with many large annotations as too long to share by link", () => {
    const g = sample() as InfrastructureGraph & { annotations?: Annotation[] };
    // Many sizeable note annotations push the encoded payload past the budget.
    g.annotations = Array.from({ length: 400 }, (_, i) => ({
      id: `note-${i}`,
      kind: "note" as const,
      text: `Annotation ${i}: ${"x".repeat(64)}`,
      x: i,
      y: i,
    }));
    const url = buildShareUrl("https://strata.mk-dir.com/", g);
    expect(url.length).toBeGreaterThan(MAX_SHARE_URL_LENGTH);
    expect(isShareUrlTooLong(url)).toBe(true);
  });
});
