import { describe, it, expect } from "vitest";
import { handleMcpMessage, TOOLS } from "./server";

/** Call a tool through the JSON-RPC dispatcher and JSON-parse its text result. */
async function call(name: string, args: Record<string, unknown> = {}) {
  const res = await handleMcpMessage({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name, arguments: args },
  });
  const content = (res?.result as { content: { text: string }[]; isError?: boolean }) ?? null;
  const text = content?.content[0]?.text ?? "";
  return {
    isError: !!content?.isError,
    // Successful tool results are JSON; error results carry a plain message.
    data: content && !content.isError ? JSON.parse(text) : text,
  };
}

describe("MCP server — protocol", () => {
  it("responds to initialize with server info + tools capability", async () => {
    const res = await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "initialize" });
    const r = res!.result as { serverInfo: { name: string }; capabilities: { tools: unknown } };
    expect(r.serverInfo.name).toBe("strata");
    expect(r.capabilities.tools).toBeDefined();
  });

  it("ignores notifications (no response)", async () => {
    expect(
      await handleMcpMessage({ jsonrpc: "2.0", method: "notifications/initialized" }),
    ).toBeNull();
  });

  it("lists all registered tools", async () => {
    const res = await handleMcpMessage({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const names = (res!.result as { tools: { name: string }[] }).tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(TOOLS.map((t) => t.name)));
    expect(names).toContain("validate_architecture");
  });

  it("registers the newly-wired engine tools", async () => {
    const res = await handleMcpMessage({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const names = (res!.result as { tools: { name: string }[] }).tools.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "review_account",
        "evaluate_reachability",
        "map_to_cloud",
        "graph_to_dsl",
        "graph_from_dsl",
        "list_autofixes",
        "apply_autofix",
        "change_receipt",
        "tag_report",
        "connect_repo",
        "list_repo_roots",
      ]),
    );
  });

  it("returns method-not-found for an unknown request", async () => {
    const res = await handleMcpMessage({ jsonrpc: "2.0", id: 3, method: "nope" });
    expect(res!.error?.code).toBe(-32601);
  });
});

describe("MCP server — tools", () => {
  it("list_services filters by provider", async () => {
    const { data } = await call("list_services", { provider: "gcp" });
    expect(data.count).toBeGreaterThan(0);
    expect(data.services.every((s: { provider: string }) => s.provider === "gcp")).toBe(true);
  });

  it("get_service returns a definition, and errors on unknown id", async () => {
    expect((await call("get_service", { id: "vpc" })).data.id).toBe("vpc");
    const bad = await call("get_service", { id: "nope" });
    expect(bad.isError).toBe(true);
  });

  it("validate_architecture flags an issue and counts levels", async () => {
    const { data } = await call("validate_architecture", {
      graph: {
        resources: [
          { id: "sn", serviceId: "subnet-public", name: "sn", config: {}, source: "manual" },
        ],
        relationships: [],
      },
    });
    expect(data.errors).toBeGreaterThan(0);
    expect(
      data.findings.some((f: { message: string }) => /contained by a VPC/.test(f.message)),
    ).toBe(true);
  });

  it("estimate_cost totals a graph", async () => {
    const { data } = await call("estimate_cost", {
      graph: {
        resources: [{ id: "n", serviceId: "nat-gateway", name: "n", config: {}, source: "manual" }],
      },
    });
    expect(data.total).toBe(32);
    expect(data.currency).toMatch(/USD/);
  });

  it("import_iac parses CloudFormation", async () => {
    const { data } = await call("import_iac", {
      content: JSON.stringify({ Resources: { V: { Type: "AWS::EC2::VPC", Properties: {} } } }),
    });
    expect(data.format).toBe("cloudformation");
    expect(data.resourceCount).toBe(1);
  });

  it("export_iac generates Terraform", async () => {
    const { data } = await call("export_iac", {
      graph: {
        resources: [{ id: "v", serviceId: "vpc", name: "v", config: {}, source: "manual" }],
        relationships: [],
      },
      format: "terraform",
    });
    expect(data.content).toContain('resource "aws_vpc"');
  });

  it("graph_to_dsl and graph_from_dsl round-trip a graph", async () => {
    const graph = {
      resources: [{ id: "v", serviceId: "vpc", name: "v", config: {}, source: "manual" }],
      relationships: [],
    };
    const { data: out } = await call("graph_to_dsl", { graph });
    expect(typeof out.dsl).toBe("string");
    const { data: back } = await call("graph_from_dsl", { dsl: out.dsl });
    expect(Array.isArray(back.errors)).toBe(true);
    expect(back.graph.resources.some((r: { id: string }) => r.id === "v")).toBe(true);
  });

  it("list_autofixes returns a fixes array", async () => {
    const { data } = await call("list_autofixes", {
      graph: { resources: [], relationships: [] },
    });
    expect(typeof data.count).toBe("number");
    expect(Array.isArray(data.fixes)).toBe(true);
  });

  it("map_to_cloud rewrites onto a target provider", async () => {
    const { data } = await call("map_to_cloud", {
      graph: {
        resources: [{ id: "v", serviceId: "vpc", name: "v", config: {}, source: "manual" }],
        relationships: [],
      },
      target: "gcp",
    });
    expect(data.graph).toBeDefined();
    expect(Array.isArray(data.unmapped)).toBe(true);
  });

  it("connect_repo requires a path and errors on a missing one", async () => {
    expect((await call("connect_repo", {})).isError).toBe(true);
    expect((await call("connect_repo", { path: "/no/such/repo/here" })).isError).toBe(true);
  });

  it("reports an unknown tool as an error result (not a protocol error)", async () => {
    const res = await handleMcpMessage({
      jsonrpc: "2.0",
      id: 9,
      method: "tools/call",
      params: { name: "does_not_exist", arguments: {} },
    });
    const r = res!.result as { isError: boolean };
    expect(r.isError).toBe(true);
  });
});
