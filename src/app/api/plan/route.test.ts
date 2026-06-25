// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest";

const importPlanJson = vi.fn();
const runRepoPlan = vi.fn();

vi.mock("../../../server/runPlan", () => ({
  importPlanJson: (...a: unknown[]) => importPlanJson(...a),
  runRepoPlan: (...a: unknown[]) => runRepoPlan(...a),
}));

type Route = typeof import("./route");
let route: Route;

const post = (body: unknown) =>
  new Request("http://localhost/api/plan", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(async () => {
  vi.resetModules();
  importPlanJson.mockReset();
  runRepoPlan.mockReset();
  delete process.env.AWS_FLOW_API_TOKEN;
  route = await import("./route");
});

describe("POST /api/plan", () => {
  it("ingests a plan JSON without running terraform", async () => {
    importPlanJson.mockReturnValue({
      graph: { resources: [] },
      diff: { changes: {}, counts: {} },
      warnings: [],
    });
    const res = await route.POST(post({ planJson: { resource_changes: [] } }));
    expect(res.status).toBe(200);
    expect(importPlanJson).toHaveBeenCalled();
    expect(runRepoPlan).not.toHaveBeenCalled();
  });

  it("runs a repo plan when given repoPath", async () => {
    runRepoPlan.mockResolvedValue({
      graph: { resources: [] },
      diff: { changes: {}, counts: {} },
      warnings: [],
    });
    const res = await route.POST(post({ repoPath: "/repo", root: "prod" }));
    expect(res.status).toBe(200);
    expect(runRepoPlan).toHaveBeenCalledWith("/repo", { root: "prod" });
  });

  it("422s when neither planJson nor repoPath is given", async () => {
    const res = await route.POST(post({}));
    expect(res.status).toBe(422);
  });

  it("maps a missing-binary error to 422", async () => {
    runRepoPlan.mockRejectedValue(new Error("No terraform/tofu binary found on PATH."));
    const res = await route.POST(post({ repoPath: "/repo" }));
    expect(res.status).toBe(422);
  });
});
