// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * Route handler tests for POST /api/discover, focused on the credential model:
 *   - per-request "bring-your-own" creds are passed to the client and not stored
 *   - a hosted deployment refuses to scan with the operator's ambient creds
 *   - malformed creds are rejected rather than silently ignored
 *
 * The AWS SDK is mocked so no network calls happen; we capture the config the
 * route passes to `CloudControlClient` to assert how credentials are wired.
 */

let lastClientConfig: Record<string, unknown> | null = null;

vi.mock("@aws-sdk/client-cloudcontrol", () => {
  class CloudControlClient {
    constructor(config: Record<string, unknown>) {
      lastClientConfig = config;
    }
    async send() {
      return { ResourceDescriptions: [], NextToken: undefined };
    }
  }
  class ListResourcesCommand {
    constructor(public input: unknown) {}
  }
  return { CloudControlClient, ListResourcesCommand };
});

type DiscoverRoute = typeof import("./route");
let route: DiscoverRoute;

function post(body: unknown): Request {
  return new Request("http://localhost/api/discover", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validScan = { region: "us-east-1", types: ["AWS::S3::Bucket"] };
const validCreds = { accessKeyId: "AKIAEXAMPLE", secretAccessKey: "secret" };

beforeEach(async () => {
  lastClientConfig = null;
  delete process.env.NEXT_PUBLIC_STRATA_HOSTED;
  vi.resetModules();
  route = await import("./route");
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_STRATA_HOSTED;
});

describe("POST /api/discover — credential model", () => {
  it("passes user-supplied creds to the client", async () => {
    const res = await route.POST(
      post({ ...validScan, creds: { ...validCreds, sessionToken: "tok" } }),
    );
    expect(res.status).toBe(200);
    expect(lastClientConfig?.credentials).toEqual({
      accessKeyId: "AKIAEXAMPLE",
      secretAccessKey: "secret",
      sessionToken: "tok",
    });
  });

  it("uses the ambient chain (no explicit credentials) when creds are omitted, locally", async () => {
    const res = await route.POST(post(validScan));
    expect(res.status).toBe(200);
    // No `credentials` key → SDK resolves its own default chain.
    expect(lastClientConfig).not.toBeNull();
    expect("credentials" in (lastClientConfig as object)).toBe(false);
  });

  it("rejects a hosted scan with no creds (422) — never touches ambient creds", async () => {
    process.env.NEXT_PUBLIC_STRATA_HOSTED = "1";
    vi.resetModules();
    route = await import("./route");

    const res = await route.POST(post(validScan));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      error: "Enter AWS credentials to run a live scan, or use the Paste export tab.",
    });
    // Crucially, no client was ever constructed.
    expect(lastClientConfig).toBeNull();
  });

  it("allows a hosted scan when the user brings creds", async () => {
    process.env.NEXT_PUBLIC_STRATA_HOSTED = "1";
    vi.resetModules();
    route = await import("./route");

    const res = await route.POST(post({ ...validScan, creds: validCreds }));
    expect(res.status).toBe(200);
    expect(lastClientConfig?.credentials).toMatchObject(validCreds);
  });

  it("rejects partial creds (422) rather than falling through to ambient", async () => {
    const res = await route.POST(post({ ...validScan, creds: { accessKeyId: "AKIA" } }));
    expect(res.status).toBe(422);
    expect(lastClientConfig).toBeNull();
  });

  it("ignores a blank session token (sends undefined, not empty string)", async () => {
    const res = await route.POST(post({ ...validScan, creds: { ...validCreds, sessionToken: "  " } }));
    expect(res.status).toBe(200);
    expect((lastClientConfig?.credentials as { sessionToken?: string }).sessionToken).toBeUndefined();
  });
});
