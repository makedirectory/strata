// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { POST } from "./route";

function post(body: unknown) {
  return POST(
    new Request("http://test/api/interest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

describe("POST /api/interest", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("logs the signal and returns 204 (no webhook configured → no fetch)", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const res = await post({ feature: "cost-optimization", note: "yes" });
    expect(res.status).toBe(204);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("cost-optimization"));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("forwards to STRATA_INTEREST_WEBHOOK when set (text + content for Slack/Discord)", async () => {
    const fetchSpy = vi.fn((..._args: unknown[]) =>
      Promise.resolve(new Response(null, { status: 200 })),
    );
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubEnv("STRATA_INTEREST_WEBHOOK", "https://hooks.example/abc");
    const res = await post({ feature: "cost-optimization" });
    expect(res.status).toBe(204);
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, opts] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://hooks.example/abc");
    const sent = JSON.parse(String(opts.body));
    expect(sent.text).toContain("cost-optimization");
    expect(sent.content).toBe(sent.text);
  });

  it("still returns 204 when the webhook fetch fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("down"))),
    );
    vi.stubEnv("STRATA_INTEREST_WEBHOOK", "https://hooks.example/abc");
    expect((await post({ feature: "drift" })).status).toBe(204);
  });

  it("rejects malformed or oversized payloads with 400", async () => {
    expect((await post("not json")).status).toBe(400);
    expect((await post({})).status).toBe(400);
    expect((await post({ feature: "has spaces!" })).status).toBe(400);
    expect((await post({ feature: "x".repeat(65) })).status).toBe(400);
  });
});
