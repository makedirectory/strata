import { describe, it, expect } from "vitest";
import {
  normalizeAssets,
  parseGcpExport,
  listGcpDiscoverableTypes,
  discoverGcpWithClient,
  type CloudAssetClientLike,
} from "./discovery";
import { mapDiscoveredToGraph, unmappedTypes } from "../aws/mcp";
import { getService } from "../aws/registry";

// A recorded Cloud Asset Inventory response shape (no live GCP).
const assets = [
  {
    name: "//compute.googleapis.com/projects/p/global/networks/main",
    assetType: "compute.googleapis.com/Network",
    resource: { data: { name: "main", autoCreateSubnetworks: false } },
  },
  {
    name: "//storage.googleapis.com/projects/p/buckets/assets",
    assetType: "storage.googleapis.com/Bucket",
    resource: { data: { name: "assets" }, location: "us" },
  },
  {
    name: "//unknown.googleapis.com/Thing",
    assetType: "unknown.googleapis.com/Thing",
    resource: { data: {} },
  },
];

describe("GCP CAI normalisation", () => {
  it("normalises assets into DiscoveredResource[] tagged provider gcp", () => {
    const resources = normalizeAssets(assets);
    expect(resources).toHaveLength(3);
    expect(resources.every((r) => r.provider === "gcp")).toBe(true);
    expect(resources[0].resourceType).toBe("compute.googleapis.com/Network");
    expect(resources[0].name).toBe("main");
  });

  it("feeds mapDiscoveredToGraph; unknown asset types are reported, not crashed", () => {
    const resources = normalizeAssets(assets);
    const graph = mapDiscoveredToGraph(resources);
    // The two modeled assets map; the unknown one is skipped.
    expect(graph.resources).toHaveLength(2);
    for (const r of graph.resources) expect(getService(r.serviceId)?.provider).toBe("gcp");
    expect(unmappedTypes(resources)).toEqual(["unknown.googleapis.com/Thing"]);
  });
});

describe("GCP discoverable types", () => {
  it("derives the allow-list from the registry (gcp only)", () => {
    const types = listGcpDiscoverableTypes();
    expect(types.length).toBeGreaterThan(20);
    // Every entry is a fully-formed Cloud Asset Inventory asset type
    // (`<service>.googleapis.com/<Kind>`) — anchored so it's a format check, not
    // a URL-host substring match.
    expect(
      types.every((t) => /^[a-z][a-z0-9-]*\.googleapis\.com\/[A-Za-z]+$/.test(t.assetType)),
    ).toBe(true);
  });
});

describe("GCP paste export", () => {
  it("parses a gcloud asset list array and an { assets: [...] } envelope", () => {
    const arr = parseGcpExport(JSON.stringify(assets));
    expect(arr).toHaveLength(3);
    const env = parseGcpExport(JSON.stringify({ assets }));
    expect(env).toHaveLength(3);
    expect(env.every((r) => r.provider === "gcp")).toBe(true);
  });

  it("throws a clear error on invalid JSON", () => {
    expect(() => parseGcpExport("not json")).toThrow(/JSON/);
  });
});

describe("GCP discover via injected client", () => {
  it("never throws on client error and returns a credential-free warning", async () => {
    const failing: CloudAssetClientLike = {
      listAssets: async () => {
        throw new Error("ADC not found");
      },
    };
    const result = await discoverGcpWithClient(failing, {
      scope: "projects/p",
      assetTypes: ["compute.googleapis.com/Network"],
    });
    expect(result.resources).toEqual([]);
    expect(result.warnings[0]).toContain("projects/p");
    // The warning surfaces the failure but never leaks credential material.
    expect(JSON.stringify(result)).not.toMatch(/secret|token|key|password/i);
  });
});
