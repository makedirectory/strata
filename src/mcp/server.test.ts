import { describe, it, expect } from "vitest";
import { handleMcpMessage, TOOLS } from "./server";

/** Call a tool through the JSON-RPC dispatcher and JSON-parse its text result. */
function call(name: string, args: Record<string, unknown> = {}) {
  const res = handleMcpMessage({
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
  it("responds to initialize with server info + tools capability", () => {
    const res = handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "initialize" });
    const r = res!.result as { serverInfo: { name: string }; capabilities: { tools: unknown } };
    expect(r.serverInfo.name).toBe("strata");
    expect(r.capabilities.tools).toBeDefined();
  });

  it("ignores notifications (no response)", () => {
    expect(handleMcpMessage({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeNull();
  });

  it("lists all registered tools", () => {
    const res = handleMcpMessage({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const names = (res!.result as { tools: { name: string }[] }).tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(TOOLS.map((t) => t.name)));
    expect(names).toContain("validate_architecture");
  });

  it("returns method-not-found for an unknown request", () => {
    const res = handleMcpMessage({ jsonrpc: "2.0", id: 3, method: "nope" });
    expect(res!.error?.code).toBe(-32601);
  });
});

describe("MCP server — tools", () => {
  it("list_services filters by provider", () => {
    const { data } = call("list_services", { provider: "gcp" });
    expect(data.count).toBeGreaterThan(0);
    expect(data.services.every((s: { provider: string }) => s.provider === "gcp")).toBe(true);
  });

  it("get_service returns a definition, and errors on unknown id", () => {
    expect(call("get_service", { id: "vpc" }).data.id).toBe("vpc");
    const bad = call("get_service", { id: "nope" });
    expect(bad.isError).toBe(true);
  });

  it("validate_architecture flags an issue and counts levels", () => {
    const { data } = call("validate_architecture", {
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

  it("estimate_cost totals a graph", () => {
    const { data } = call("estimate_cost", {
      graph: {
        resources: [{ id: "n", serviceId: "nat-gateway", name: "n", config: {}, source: "manual" }],
      },
    });
    expect(data.total).toBe(32);
    expect(data.currency).toMatch(/USD/);
  });

  it("import_iac parses CloudFormation", () => {
    const { data } = call("import_iac", {
      content: JSON.stringify({ Resources: { V: { Type: "AWS::EC2::VPC", Properties: {} } } }),
    });
    expect(data.format).toBe("cloudformation");
    expect(data.resourceCount).toBe(1);
  });

  it("export_iac generates Terraform", () => {
    const { data } = call("export_iac", {
      graph: {
        resources: [{ id: "v", serviceId: "vpc", name: "v", config: {}, source: "manual" }],
        relationships: [],
      },
      format: "terraform",
    });
    expect(data.content).toContain('resource "aws_vpc"');
  });

  it("reports an unknown tool as an error result (not a protocol error)", () => {
    const res = handleMcpMessage({
      jsonrpc: "2.0",
      id: 9,
      method: "tools/call",
      params: { name: "does_not_exist", arguments: {} },
    });
    const r = res!.result as { isError: boolean };
    expect(r.isError).toBe(true);
  });
});
