// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * Route tests for POST /api/connect-repo. The connector is mocked so no fs or
 * terraform runs; we assert request parsing, the detectOnly branch, and that
 * connector errors map to sensible status codes.
 */

const connectRepo = vi.fn();
const detectRepoRoots = vi.fn();

vi.mock("../../../server/connectRepo", () => ({
  connectRepo: (...args: unknown[]) => connectRepo(...args),
  detectRepoRoots: (...args: unknown[]) => detectRepoRoots(...args),
}));

type ConnectRoute = typeof import("./route");
let route: ConnectRoute;

function post(body: unknown): Request {
  return new Request("http://localhost/api/connect-repo", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  vi.resetModules();
  connectRepo.mockReset();
  detectRepoRoots.mockReset();
  delete process.env.AWS_FLOW_API_TOKEN;
  route = await import("./route");
});

afterEach(() => {
  delete process.env.AWS_FLOW_API_TOKEN;
});

describe("POST /api/connect-repo", () => {
  it("rejects a body without a path (422)", async () => {
    const res = await route.POST(post({}));
    expect(res.status).toBe(422);
    expect(connectRepo).not.toHaveBeenCalled();
  });

  it("returns roots for a detectOnly request", async () => {
    detectRepoRoots.mockResolvedValue([{ dir: "environments/prod", name: "prod" }]);
    const res = await route.POST(post({ path: "/repo", detectOnly: true }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ roots: [{ dir: "environments/prod", name: "prod" }] });
    expect(connectRepo).not.toHaveBeenCalled();
  });

  it("passes roots + strategy through to connectRepo", async () => {
    connectRepo.mockResolvedValue({
      graph: { resources: [] },
      roots: [],
      unmappedTypes: [],
      warnings: [],
    });
    const res = await route.POST(post({ path: "/repo", roots: ["prod"], strategy: "static" }));
    expect(res.status).toBe(200);
    expect(connectRepo).toHaveBeenCalledWith("/repo", { roots: ["prod"], strategy: "static" });
  });

  it("ignores an invalid strategy value", async () => {
    connectRepo.mockResolvedValue({
      graph: { resources: [] },
      roots: [],
      unmappedTypes: [],
      warnings: [],
    });
    await route.POST(post({ path: "/repo", strategy: "bogus" }));
    expect(connectRepo).toHaveBeenCalledWith("/repo", { roots: undefined, strategy: undefined });
  });

  it("maps a bad-path error to 422", async () => {
    connectRepo.mockRejectedValue(new Error("Path not found: /nope"));
    const res = await route.POST(post({ path: "/nope" }));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/not found/);
  });

  it("maps an unexpected error to 500", async () => {
    connectRepo.mockRejectedValue(new Error("kaboom"));
    const res = await route.POST(post({ path: "/repo" }));
    expect(res.status).toBe(500);
  });
});
