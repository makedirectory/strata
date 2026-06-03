/**
 * Strata MCP server — exposes the registry, validation, IaC and cost engines to
 * an LLM/agent over the Model Context Protocol.
 *
 * The README frames Strata as "MCP-native"; this is that server. It is a thin
 * wrapper over the same PURE functions the app uses (registry, rules, cost,
 * importAnyIaC, exportIaC), so an agent can reason about and transform a graph
 * exactly as the UI does. No DOM, no network, no credentials.
 *
 * Transport: newline-delimited JSON-RPC 2.0 over stdio (the MCP stdio
 * transport). `handleMcpMessage` is pure and unit-tested; `runStdio` wires it to
 * the process streams. Run it with `npm run mcp` (which uses `npx tsx`), and
 * point an MCP client at that command.
 */
import { version as SERVER_VERSION } from "../../package.json";
import type { InfrastructureGraph } from "../aws/model";
import { emptyGraph } from "../aws/model";
import { allServices, getService, searchServices, serviceProvider } from "../aws/registry";
import { validateArchitecture, suggestRules } from "../aws/rules";
import { evaluateReachability } from "../aws/reachability";
import { estimateMonthlyCost, estimateTotal } from "../aws/cost";
import { reviewAccount } from "../aws/review";
import { mapToCloud } from "../aws/cloudMap";
import { detectFixes, applyFix } from "../aws/autofix";
import { changeReceipt, renderMarkdown } from "../aws/receipt";
import { collectTagKeys, collectTagValues, tagCoverage } from "../aws/tags";
import { importAnyIaC } from "../lib/importIac";
import { exportIaC, type ExportFormat } from "../aws/iacExport";
import { graphToDsl, dslToGraph } from "../aws/dsl";
import type { CloudProvider } from "../aws/types";

/** MCP protocol revision this server speaks. */
const PROTOCOL_VERSION = "2024-11-05";

type Args = Record<string, unknown>;
const str = (a: Args, k: string): string | undefined =>
  typeof a[k] === "string" ? (a[k] as string) : undefined;

/** Coerce an untrusted argument into a usable InfrastructureGraph. */
function coerceGraph(value: unknown): InfrastructureGraph {
  const g = (
    typeof value === "object" && value !== null ? value : {}
  ) as Partial<InfrastructureGraph>;
  return {
    ...emptyGraph(typeof g.name === "string" ? g.name : "graph"),
    ...g,
    resources: Array.isArray(g.resources) ? g.resources : [],
    relationships: Array.isArray(g.relationships) ? g.relationships : [],
    accounts: Array.isArray(g.accounts) ? g.accounts : [],
  };
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run: (args: Args) => unknown;
}

const objectSchema = (
  properties: Record<string, unknown>,
  required: string[] = [],
): Record<string, unknown> => ({ type: "object", properties, required });

const GRAPH_SCHEMA = {
  type: "object",
  description: "An InfrastructureGraph (resources[] + relationships[] is enough for most tools).",
  properties: {
    resources: { type: "array", items: { type: "object" } },
    relationships: { type: "array", items: { type: "object" } },
  },
};

/** The tools an MCP client can list and call. */
export const TOOLS: McpTool[] = [
  {
    name: "list_services",
    description:
      "List/search the cloud service registry (AWS, GCP, Azure). Optionally filter by provider, category, or a free-text query.",
    inputSchema: objectSchema({
      provider: { type: "string", enum: ["aws", "gcp", "azure"] },
      category: { type: "string" },
      query: { type: "string" },
    }),
    run: (a) => {
      const provider = str(a, "provider") as CloudProvider | undefined;
      const query = str(a, "query");
      const category = str(a, "category");
      let pool = query ? searchServices(query, provider) : [...allServices(provider)];
      if (category) pool = pool.filter((s) => s.category === category);
      return {
        count: pool.length,
        services: pool.map((s) => ({
          id: s.id,
          name: s.name,
          provider: serviceProvider(s),
          category: s.category,
          description: s.description,
        })),
      };
    },
  },
  {
    name: "get_service",
    description:
      "Get the full definition of one service by id: config fields, suggested connections, native IaC type.",
    inputSchema: objectSchema({ id: { type: "string" } }, ["id"]),
    run: (a) => {
      const id = str(a, "id");
      const s = id ? getService(id) : undefined;
      if (!s) throw new Error(`Unknown service id: ${id ?? "(missing)"}`);
      return {
        id: s.id,
        name: s.name,
        fullName: s.fullName,
        provider: serviceProvider(s),
        category: s.category,
        description: s.description,
        scope: s.scope,
        isContainer: !!s.isContainer,
        nativeType: s.nativeType ?? s.cfnType,
        configFields: s.configFields,
        commonConnections: s.commonConnections,
      };
    },
  },
  {
    name: "validate_architecture",
    description:
      "Run Strata's architecture + Well-Architected validation over a graph. Returns findings (level, message, resourceId).",
    inputSchema: objectSchema({ graph: GRAPH_SCHEMA }, ["graph"]),
    run: (a) => {
      const findings = validateArchitecture(coerceGraph(a.graph));
      const errors = findings.filter((f) => f.level === "error").length;
      const warnings = findings.filter((f) => f.level === "warn").length;
      return { errors, warnings, findings };
    },
  },
  {
    name: "suggest_rules",
    description: "Suggest security-group / route-table / NACL rules for a graph.",
    inputSchema: objectSchema({ graph: GRAPH_SCHEMA }, ["graph"]),
    run: (a) => ({ suggestions: suggestRules(coerceGraph(a.graph)) }),
  },
  {
    name: "import_iac",
    description:
      "Parse Infrastructure-as-Code (CloudFormation JSON/YAML, Terraform `show -json`, or Azure ARM) into a Strata graph. Auto-detects the format.",
    inputSchema: objectSchema({ content: { type: "string" }, name: { type: "string" } }, [
      "content",
    ]),
    run: (a) => {
      const content = str(a, "content");
      if (!content) throw new Error("`content` (the IaC document text) is required.");
      const r = importAnyIaC(content, { name: str(a, "name") });
      return {
        format: r.format,
        resourceCount: r.graph.resources.length,
        unmappedTypes: r.unmappedTypes,
        warnings: r.warnings,
        graph: r.graph,
      };
    },
  },
  {
    name: "export_iac",
    description:
      "Generate IaC from a graph (a scaffold to finish). Formats: cloudformation-json, cloudformation-yaml, terraform.",
    inputSchema: objectSchema(
      {
        graph: GRAPH_SCHEMA,
        format: {
          type: "string",
          enum: ["cloudformation-json", "cloudformation-yaml", "terraform"],
        },
      },
      ["graph", "format"],
    ),
    run: (a) => {
      const format = str(a, "format") as ExportFormat | undefined;
      if (
        format !== "cloudformation-json" &&
        format !== "cloudformation-yaml" &&
        format !== "terraform"
      ) {
        throw new Error(`Unsupported format: ${format ?? "(missing)"}`);
      }
      const out = exportIaC(coerceGraph(a.graph), format);
      return { filename: out.filename, content: out.content, report: out.report };
    },
  },
  {
    name: "estimate_cost",
    description:
      "Rough monthly USD estimate per resource + diagram total (us-east-1 baseline; ignores usage/transfer/discounts).",
    inputSchema: objectSchema({ graph: GRAPH_SCHEMA }, ["graph"]),
    run: (a) => {
      const graph = coerceGraph(a.graph);
      const totals = estimateTotal(graph.resources);
      return {
        currency: "USD/month (rough)",
        total: Math.round(totals.total),
        estimatedResources: totals.estimated,
        unknownResources: totals.unknown,
        resources: graph.resources.map((r) => ({
          id: r.id,
          name: r.name,
          serviceId: r.serviceId,
          monthly: estimateMonthlyCost(r),
        })),
      };
    },
  },
  {
    name: "review_account",
    description:
      "Explain & Clean: review a graph for a cost-map summary, scored risk findings, tag coverage, orphan/unconnected resources, and a safe-cleanup checklist. Composes validation + cost; nothing is silently dropped (unknown-cost resources are counted).",
    inputSchema: objectSchema({ graph: GRAPH_SCHEMA }, ["graph"]),
    run: (a) => reviewAccount(coerceGraph(a.graph)),
  },
  {
    name: "evaluate_reachability",
    description:
      "Evaluate internet reachability for a graph: which resources are reachable from the public internet (via public-subnet routing or an external-facing edge service), the world-open ports on them, and risk notes for sensitive exposed ports.",
    inputSchema: objectSchema({ graph: GRAPH_SCHEMA }, ["graph"]),
    run: (a) => {
      const r = evaluateReachability(coerceGraph(a.graph));
      return {
        exposed: r.exposed,
        internetReachableIds: [...r.internetReachableIds].sort(),
        publicSubnetIds: [...r.publicSubnetIds].sort(),
        notes: r.notes,
      };
    },
  },
  {
    name: "map_to_cloud",
    description:
      "Translate an InfrastructureGraph onto another cloud provider. Rewrites each resource to the target provider's closest service (by category + capability) and returns the rewritten graph plus an honest list of resources with no equivalent. Does not mutate the input.",
    inputSchema: objectSchema(
      {
        graph: GRAPH_SCHEMA,
        target: { type: "string", enum: ["aws", "gcp", "azure"] },
      },
      ["graph", "target"],
    ),
    run: (a) => {
      const target = (str(a, "target") ?? "aws") as CloudProvider;
      return mapToCloud(coerceGraph(a.graph), target);
    },
  },
  {
    name: "graph_to_dsl",
    description:
      "Serialize an InfrastructureGraph into Strata's human-readable, round-trippable YAML DSL (diagram-as-code).",
    inputSchema: objectSchema({ graph: GRAPH_SCHEMA }, ["graph"]),
    run: (a) => {
      const graph = coerceGraph(a.graph);
      return { dsl: graphToDsl(graph) };
    },
  },
  {
    name: "graph_from_dsl",
    description:
      "Parse Strata's YAML DSL (diagram-as-code) back into an InfrastructureGraph. Never throws: malformed input and structural problems are returned in errors[].",
    inputSchema: objectSchema({ dsl: { type: "string" } }, ["dsl"]),
    run: (a) => {
      const dsl = str(a, "dsl");
      if (dsl === undefined) throw new Error("graph_from_dsl requires a `dsl` string argument");
      const { graph, errors } = dslToGraph(dsl);
      return { graph, errors };
    },
  },
  {
    name: "list_autofixes",
    description:
      "Detect mechanically-fixable misconfigurations in a graph (open security-group ports, missing public-subnet internet route, unencrypted storage, mis-placed NAT). Returns Fixable[] with stable ids to pass to apply_autofix.",
    inputSchema: objectSchema({ graph: GRAPH_SCHEMA }, ["graph"]),
    run: (a) => {
      const fixes = detectFixes(coerceGraph(a.graph));
      return { count: fixes.length, fixes };
    },
  },
  {
    name: "apply_autofix",
    description:
      "Apply one autofix to a graph by its Fixable id (from list_autofixes) and return the modified graph. Unknown/stale ids are a safe no-op (graph returned unchanged). Never mutates the input.",
    inputSchema: objectSchema({ graph: GRAPH_SCHEMA, fixId: { type: "string" } }, [
      "graph",
      "fixId",
    ]),
    run: (a) => {
      const fixId = str(a, "fixId");
      if (!fixId) throw new Error("`fixId` (a Fixable.id from list_autofixes) is required.");
      const before = coerceGraph(a.graph);
      const after = applyFix(before, fixId);
      return { applied: after !== before, graph: after };
    },
  },
  {
    name: "change_receipt",
    description:
      "Compare two InfrastructureGraphs (before vs after) and return a deterministic change/audit receipt: resource churn (added/removed/changed), monthly cost delta, validation findings resolved vs introduced, a plain-English summary, and a rendered Markdown report.",
    inputSchema: objectSchema({ before: GRAPH_SCHEMA, after: GRAPH_SCHEMA }, ["before", "after"]),
    run: (a) => {
      const receipt = changeReceipt(coerceGraph(a.before), coerceGraph(a.after));
      return { receipt, markdown: renderMarkdown(receipt) };
    },
  },
  {
    name: "tag_report",
    description:
      "Report tag coverage for a graph: every tag key in use, its distinct values, and the tagged/untagged resource split.",
    inputSchema: objectSchema({ graph: GRAPH_SCHEMA }, ["graph"]),
    run: (a) => {
      const graph = coerceGraph(a.graph);
      const keys = collectTagKeys(graph);
      return {
        keys,
        values: Object.fromEntries(keys.map((k) => [k, collectTagValues(graph, k)])),
        coverage: tagCoverage(graph),
      };
    },
  },
];

// ---- JSON-RPC plumbing -----------------------------------------------------

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Args;
}
interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
}

const ok = (id: string | number | null, result: unknown): JsonRpcResponse => ({
  jsonrpc: "2.0",
  id,
  result,
});
const fail = (id: string | number | null, code: number, message: string): JsonRpcResponse => ({
  jsonrpc: "2.0",
  id,
  error: { code, message },
});

/**
 * Handle one JSON-RPC message. Returns the response, or `null` for
 * notifications (no `id` / `notifications/*`) which must not be answered.
 */
export function handleMcpMessage(msg: JsonRpcRequest): JsonRpcResponse | null {
  const id = msg.id ?? null;
  switch (msg.method) {
    case "initialize":
      return ok(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "strata", version: SERVER_VERSION },
      });
    case "notifications/initialized":
      return null;
    case "ping":
      return ok(id, {});
    case "tools/list":
      return ok(id, {
        tools: TOOLS.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      });
    case "tools/call": {
      const name = typeof msg.params?.name === "string" ? msg.params.name : "";
      const tool = TOOLS.find((t) => t.name === name);
      if (!tool) {
        return ok(id, {
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
          isError: true,
        });
      }
      const args = (
        typeof msg.params?.arguments === "object" && msg.params?.arguments !== null
          ? msg.params.arguments
          : {}
      ) as Args;
      try {
        const result = tool.run(args);
        return ok(id, { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] });
      } catch (e) {
        return ok(id, {
          content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }],
          isError: true,
        });
      }
    }
    default:
      // Unknown notification (no id) → ignore; unknown request → method-not-found.
      return msg.id === undefined ? null : fail(id, -32601, `Method not found: ${msg.method}`);
  }
}

/** Wire the dispatcher to stdio (newline-delimited JSON-RPC). */
export function runStdio(): void {
  let buffer = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk: string) => {
    buffer += chunk;
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      let msg: JsonRpcRequest;
      try {
        msg = JSON.parse(line) as JsonRpcRequest;
      } catch {
        continue; // skip malformed lines
      }
      const res = handleMcpMessage(msg);
      if (res) process.stdout.write(JSON.stringify(res) + "\n");
    }
  });
}
