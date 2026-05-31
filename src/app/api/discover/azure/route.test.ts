// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * Route tests for POST /api/discover/azure. The @azure SDKs are mocked so no
 * network/credentials are touched; we assert the body contract, the hosted
 * guard (no client constructed), and that a Resource Graph row is normalised.
 */

let clientConstructed = false;
let lastQuery: { subscriptions?: string[]; query?: string } | null = null;

vi.mock("@azure/identity", () => ({
  DefaultAzureCredential: class {},
}));

vi.mock("@azure/arm-resourcegraph", () => {
  class ResourceGraphClient {
    constructor() {
      clientConstructed = true;
    }
    async resources(req: { subscriptions?: string[]; query?: string }) {
      lastQuery = req;
      return {
        data: [
          {
            id: "/subscriptions/s/resourceGroups/rg/providers/Microsoft.Storage/storageAccounts/sa",
            name: "sa",
            type: "Microsoft.Storage/storageAccounts",
            location: "eastus",
            resourceGroup: "rg",
            subscriptionId: "s",
          },
        ],
        skipToken: undefined,
      };
    }
  }
  return { ResourceGraphClient };
});

type Route = typeof import("./route");
let route: Route;

function post(body: unknown): Request {
  return new Request("http://localhost/api/discover/azure", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validScan = { subscriptions: ["s"], types: ["Microsoft.Storage/storageAccounts"] };

beforeEach(async () => {
  clientConstructed = false;
  lastQuery = null;
  delete process.env.NEXT_PUBLIC_STRATA_HOSTED;
  vi.resetModules();
  route = await import("./route");
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_STRATA_HOSTED;
});

describe("POST /api/discover/azure", () => {
  it("scans with ambient creds locally and returns normalised resources tagged azure", async () => {
    const res = await route.POST(post(validScan));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.resources).toHaveLength(1);
    expect(body.resources[0].provider).toBe("azure");
    expect(body.resources[0].parentArn).toBe("rg");
    // The KQL was scoped to the requested type.
    expect(lastQuery?.query).toContain("microsoft.storage/storageaccounts");
  });

  it("rejects a hosted scan (422) and never constructs the SDK client", async () => {
    process.env.NEXT_PUBLIC_STRATA_HOSTED = "1";
    vi.resetModules();
    route = await import("./route");
    const res = await route.POST(post(validScan));
    expect(res.status).toBe(422);
    expect(clientConstructed).toBe(false);
  });

  it("rejects a body with no subscriptions (422)", async () => {
    expect((await route.POST(post({ subscriptions: [], types: ["x"] }))).status).toBe(422);
  });
});
