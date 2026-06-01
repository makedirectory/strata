import { describe, it, expect } from "vitest";
import { buildSvg, type ImageExportInputs } from "./imageExport";
import type { ResourceInstance } from "../aws/model";
import type { Rect } from "./geometry";

function res(id: string, name: string, serviceId = "ec2"): ResourceInstance {
  return { id, serviceId, name, config: {}, source: "manual" };
}

function inputs(over: Partial<ImageExportInputs> = {}): ImageExportInputs {
  const rects = new Map<string, Rect>([
    ["vpc", { x: 0, y: 0, w: 400, h: 300 }],
    ["ec2", { x: 40, y: 60, w: 200, h: 90 }],
  ]);
  return {
    resources: [res("vpc", "Main VPC", "vpc"), res("ec2", "Web")],
    edges: [{ from: "vpc", to: "ec2" }],
    rects,
    color: () => "#ff9900",
    icon: () => "🖥",
    label: (r) => r.name,
    isContainer: (id) => id === "vpc",
    ...over,
  };
}

describe("buildSvg", () => {
  it("returns an empty string for nothing to draw", () => {
    expect(buildSvg(inputs({ resources: [], rects: new Map() }))).toBe("");
  });

  it("emits a sized <svg> with a viewBox and the node labels", () => {
    const svg = buildSvg(inputs());
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("viewBox=");
    expect(svg).toContain("Main VPC");
    expect(svg).toContain("Web");
    // The edge becomes a connector line with an arrow marker.
    expect(svg).toContain("<line");
    expect(svg).toContain("marker-end");
  });

  it("XML-escapes labels so a name with markup can't break the document", () => {
    const svg = buildSvg(
      inputs({
        resources: [res("ec2", "A & B <x>", "ec2")],
        rects: new Map([["ec2", { x: 0, y: 0, w: 200, h: 90 }]]),
        edges: [],
        isContainer: () => false,
      }),
    );
    expect(svg).toContain("A &amp; B &lt;x&gt;");
    expect(svg).not.toContain("<x>");
  });

  it("sizes the canvas to the content bounds plus padding", () => {
    const svg = buildSvg(inputs(), { padding: 50 });
    // bounds are 400×300 (the VPC) → +2×50 padding = 500×400.
    expect(svg).toContain('width="500"');
    expect(svg).toContain('height="400"');
  });
});
