// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest";

const connectRepo = vi.fn();
const detectRepoRoots = vi.fn();

vi.mock("../../../server/connectRepo", () => ({
  connectRepo: (...a: unknown[]) => connectRepo(...a),
  detectRepoRoots: (...a: unknown[]) => detectRepoRoots(...a),
}));

type Route = typeof import("./route");
let route: Route;

const post = (body: unknown) =>
  new Request("http://localhost/api/connect-repo", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(async () => {
  vi.resetModules();
  connectRepo.mockReset();
  detectRepoRoots.mockReset();
  delete process.env.AWS_FLOW_API_TOKEN;
  route = await import("./route");
});

describe("POST /api/connect-repo", () => {
  it("422s without a path", async () => {
    expect((await route.POST(post({}))).status).toBe(422);
    expect(connectRepo).not.toHaveBeenCalled();
  });

  it("returns roots for detectOnly", async () => {
    detectRepoRoots.mockResolvedValue([{ dir: "environments/prod", name: "prod" }]);
    const res = await route.POST(post({ path: "/repo", detectOnly: true }));
    expect(res.status).toBe(200);
    expect((await res.json()).roots).toHaveLength(1);
    expect(connectRepo).not.toHaveBeenCalled();
  });

  it("passes roots + strategy through, ignoring an invalid strategy", async () => {
    connectRepo.mockResolvedValue({
      graph: { resources: [] },
      roots: [],
      unmappedTypes: [],
      warnings: [],
    });
    await route.POST(post({ path: "/repo", roots: ["prod"], strategy: "bogus" }));
    expect(connectRepo).toHaveBeenCalledWith("/repo", { roots: ["prod"], strategy: undefined });
  });

  it("maps a hosted/bad-path error to 422", async () => {
    connectRepo.mockRejectedValue(new Error("Path not found: /nope"));
    expect((await route.POST(post({ path: "/nope" }))).status).toBe(422);
  });
});
