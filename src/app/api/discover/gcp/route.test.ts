// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * Route tests for POST /api/discover/gcp. The @google-cloud/asset SDK is mocked
 * so no network/credentials are touched; we assert the body contract, the
 * hosted-deployment guard (no client constructed), and that a CAI asset is
 * normalised + returned.
 */

let clientConstructed = false;

vi.mock("@google-cloud/asset", () => {
  class AssetServiceClient {
    constructor() {
      clientConstructed = true;
    }
    async listAssets() {
      return [
        [
          {
            name: "//compute.googleapis.com/projects/p/global/networks/main",
            assetType: "compute.googleapis.com/Network",
            resource: {
              data: {
                fields: {
                  name: { stringValue: "main" },
                  autoCreate: { boolValue: false },
                  mtu: { numberValue: 1460 },
                  peerings: {
                    listValue: { values: [{ stringValue: "p1" }, { stringValue: "p2" }] },
                  },
                  routingConfig: { structValue: { fields: { mode: { stringValue: "REGIONAL" } } } },
                },
              },
            },
          },
        ],
      ];
    }
  }
  return { AssetServiceClient };
});

type Route = typeof import("./route");
let route: Route;

function post(body: unknown): Request {
  return new Request("http://localhost/api/discover/gcp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validScan = { scope: "projects/p", types: ["compute.googleapis.com/Network"] };

beforeEach(async () => {
  clientConstructed = false;
  delete process.env.NEXT_PUBLIC_STRATA_HOSTED;
  vi.resetModules();
  route = await import("./route");
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_STRATA_HOSTED;
});

describe("POST /api/discover/gcp", () => {
  it("scans with ambient ADC locally and returns normalised resources tagged gcp", async () => {
    const res = await route.POST(post(validScan));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.resources).toHaveLength(1);
    expect(body.resources[0].provider).toBe("gcp");
    // The protobuf Struct (`fields`) was decoded to plain JSON, including nested
    // list / struct / scalar Value wrappers.
    const props = body.resources[0].properties;
    expect(props.name).toBe("main");
    expect(props.autoCreate).toBe(false);
    expect(props.mtu).toBe(1460);
    expect(props.peerings).toEqual(["p1", "p2"]);
    expect(props.routingConfig).toEqual({ mode: "REGIONAL" });
  });

  it("rejects a hosted scan (422) and never constructs the SDK client", async () => {
    process.env.NEXT_PUBLIC_STRATA_HOSTED = "1";
    vi.resetModules();
    route = await import("./route");
    const res = await route.POST(post(validScan));
    expect(res.status).toBe(422);
    expect(clientConstructed).toBe(false);
  });

  it("rejects a body with no scope/types (422)", async () => {
    expect((await route.POST(post({ scope: "projects/p", types: [] }))).status).toBe(422);
    expect((await route.POST(post({ types: ["x"] }))).status).toBe(422);
  });
});
