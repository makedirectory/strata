import { describe, it, expect } from "vitest";
import { detectTfRoots, mergeRootsAsLayers, type RootGraph } from "./tfRepo";
import type { HclFile } from "./hclJson";
import { emptyGraph } from "./model";
import type { ResourceInstance } from "./model";

function res(id: string, parentId?: string): ResourceInstance {
  return {
    id,
    serviceId: "vpc",
    name: id,
    source: "imported",
    config: {},
    parentId,
    position: { x: 0, y: 0, w: 240, h: 100 },
  };
}

describe("detectTfRoots", () => {
  const files: HclFile[] = [
    { path: "environments/prod/providers.tf", doc: { provider: { aws: [{}] } } },
    {
      path: "environments/prod/main.tf",
      doc: { module: { net: [{ source: "../../modules/networking" }] } },
    },
    { path: "environments/stage/providers.tf", doc: { provider: { aws: [{}] } } },
    { path: "modules/networking/main.tf", doc: { resource: { aws_vpc: { main: [{}] } } } },
  ];

  it("treats provider/backend dirs as roots", () => {
    const names = detectTfRoots(files).map((r) => r.name);
    expect(names).toEqual(["prod", "stage"]);
  });

  it("never treats a referenced local module (under modules/) as a root", () => {
    const dirs = detectTfRoots(files).map((r) => r.dir);
    expect(dirs).not.toContain("modules/networking");
  });

  it("falls back to top-level infra dirs when no provider blocks exist", () => {
    const flat: HclFile[] = [{ path: "main.tf", doc: { resource: { aws_vpc: { x: [{}] } } } }];
    expect(detectTfRoots(flat)).toEqual([{ dir: "", name: "root" }]);
  });

  it("disambiguates duplicate leaf names by parent dir", () => {
    const dup: HclFile[] = [
      { path: "a/prod/providers.tf", doc: { provider: { aws: [{}] } } },
      { path: "b/prod/providers.tf", doc: { provider: { aws: [{}] } } },
    ];
    expect(detectTfRoots(dup).map((r) => r.name)).toEqual(["a/prod", "b/prod"]);
  });
});

describe("mergeRootsAsLayers", () => {
  function rootGraph(name: string): RootGraph {
    const g = emptyGraph(name);
    g.resources = [res("vpc.main"), res("subnet.a", "vpc.main")];
    g.relationships = [
      { id: "e1", from: "subnet.a", to: "vpc.main", kind: "depends_on", source: "imported" },
    ];
    return { root: { dir: `environments/${name}`, name }, graph: g };
  }

  it("creates one account layer per root", () => {
    const m = mergeRootsAsLayers([rootGraph("prod"), rootGraph("stage")], "repo");
    expect(m.accounts.map((a) => a.name)).toEqual(["prod", "stage"]);
    expect(m.accounts[0].color).not.toBe(m.accounts[1].color);
  });

  it("namespaces ids per root so identical addresses don't collide", () => {
    const m = mergeRootsAsLayers([rootGraph("prod"), rootGraph("stage")], "repo");
    const ids = m.resources.map((r) => r.id);
    expect(ids).toContain("prod::vpc.main");
    expect(ids).toContain("stage::vpc.main");
    expect(m.resources).toHaveLength(4);
  });

  it("rewrites parentId and relationship endpoints into the namespace", () => {
    const m = mergeRootsAsLayers([rootGraph("prod")], "repo");
    const subnet = m.resources.find((r) => r.id === "prod::subnet.a");
    expect(subnet?.parentId).toBe("prod::vpc.main");
    expect(subnet?.accountId).toBe("prod");
    expect(m.relationships[0]).toMatchObject({ from: "prod::subnet.a", to: "prod::vpc.main" });
  });

  it("offsets each layer vertically to avoid overlap", () => {
    const m = mergeRootsAsLayers([rootGraph("prod"), rootGraph("stage")], "repo");
    const prodY = m.resources.find((r) => r.id === "prod::vpc.main")?.position?.y ?? 0;
    const stageY = m.resources.find((r) => r.id === "stage::vpc.main")?.position?.y ?? 0;
    expect(stageY).toBeGreaterThan(prodY);
  });
});
