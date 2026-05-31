import { describe, it, expect } from "vitest";
import {
  normalizeRows,
  listAzureDiscoverableTypes,
  buildResourceGraphQuery,
  discoverAzureWithClient,
  type ResourceGraphClientLike,
} from "./discovery";
import { mapDiscoveredToGraph, unmappedTypes } from "../aws/mcp";
import { getService } from "../aws/registry";

// Recorded Azure Resource Graph rows (no live Azure).
const rows = [
  {
    id: "/subscriptions/s/resourceGroups/rg1/providers/Microsoft.Network/virtualNetworks/vnet1",
    name: "vnet1",
    type: "Microsoft.Network/virtualNetworks",
    location: "eastus",
    resourceGroup: "rg1",
    subscriptionId: "s",
    properties: { addressSpace: { addressPrefixes: ["10.0.0.0/16"] } },
  },
  {
    id: "/subscriptions/s/resourceGroups/rg1/providers/Microsoft.Storage/storageAccounts/sa1",
    name: "sa1",
    type: "Microsoft.Storage/storageAccounts",
    location: "eastus",
    resourceGroup: "rg1",
    subscriptionId: "s",
    properties: {},
  },
  {
    id: "/x/Microsoft.Unknown/things/t1",
    name: "t1",
    type: "Microsoft.Unknown/things",
  },
];

describe("Azure Resource Graph normalisation", () => {
  it("normalises rows into DiscoveredResource[] tagged provider azure", () => {
    const resources = normalizeRows(rows);
    expect(resources).toHaveLength(3);
    expect(resources.every((r) => r.provider === "azure")).toBe(true);
    expect(resources[0].resourceType).toBe("Microsoft.Network/virtualNetworks");
    // Resource group becomes the containment parent.
    expect(resources[0].parentArn).toBe("rg1");
    expect(resources[0].accountId).toBe("s");
  });

  it("feeds mapDiscoveredToGraph; unknown ARM types are reported", () => {
    const resources = normalizeRows(rows);
    const graph = mapDiscoveredToGraph(resources);
    expect(graph.resources).toHaveLength(2);
    for (const r of graph.resources) expect(getService(r.serviceId)?.provider).toBe("azure");
    expect(unmappedTypes(resources)).toEqual(["Microsoft.Unknown/things"]);
  });
});

describe("Resource Graph query", () => {
  it("projects the expected columns and filters by type when given", () => {
    expect(buildResourceGraphQuery([])).toContain("project id, name, type");
    const q = buildResourceGraphQuery(["Microsoft.Compute/virtualMachines"]);
    expect(q).toContain("where tolower(type) in");
    expect(q).toContain("'microsoft.compute/virtualmachines'");
  });
});

describe("Azure discoverable types", () => {
  it("derives the allow-list from the registry (azure only)", () => {
    const types = listAzureDiscoverableTypes();
    expect(types.length).toBeGreaterThan(20);
    expect(types.every((t) => t.armType.startsWith("Microsoft."))).toBe(true);
  });
});

describe("Azure discover via injected client", () => {
  it("returns normalised rows from the client and is credential-free", async () => {
    const client: ResourceGraphClientLike = {
      query: async () => rows.slice(0, 2),
    };
    const result = await discoverAzureWithClient(client, { subscriptions: ["s"], types: [] });
    expect(result.resources).toHaveLength(2);
    expect(result.scanned.subscriptions).toBe(1);
    expect(JSON.stringify(result)).not.toMatch(/secret|token|password/i);
  });
});
