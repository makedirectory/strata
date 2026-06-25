/**
 * Browser fetch client for the graph REST API (`/api/graphs`).
 *
 * Thin typed wrappers around the route handlers in
 * `src/app/api/graphs/route.ts` and `src/app/api/graphs/[id]/route.ts`.
 * Each helper throws an Error carrying the server-provided `{ error }`
 * message (falling back to the HTTP status text) on a non-ok response.
 */
import type { InfrastructureGraph, GraphSummary } from "../aws/model";
import type { DiscoverResult } from "../aws/discovery";
import type { GcpDiscoverResult } from "../gcp/discovery";
import type { AzureDiscoverResult } from "../azure/discovery";

/** True for plain (non-null, non-array) objects — safe to read keys from. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Read the server error message from a non-ok response, then throw. */
async function throwError(res: Response): Promise<never> {
  let message: string | undefined;
  try {
    const body: unknown = await res.json();
    // Only trust `error` when the body is an object with a string field.
    if (isRecord(body) && typeof body.error === "string") {
      message = body.error;
    }
  } catch {
    // body was empty or not JSON — fall back to status text below
  }
  throw new Error(message ?? res.statusText);
}

/**
 * Parse a JSON response, throwing the server error on a non-ok status.
 *
 * The result is cast to `T` without deep runtime validation. Callers that
 * read a specific top-level shape pass a `validate` guard so a malformed
 * response fails fast here rather than surfacing as an undefined-property
 * error deeper in the client.
 */
async function parseJson<T>(res: Response, validate?: (value: unknown) => value is T): Promise<T> {
  if (!res.ok) await throwError(res);
  const data: unknown = await res.json();
  if (validate && !validate(data)) {
    throw new Error("Unexpected response shape from server");
  }
  return data as T;
}

/** GET /api/graphs → list graph summaries. */
export async function listGraphs(): Promise<GraphSummary[]> {
  const res = await fetch("/api/graphs");
  const body = await parseJson<{ graphs: GraphSummary[] }>(
    res,
    (v): v is { graphs: GraphSummary[] } => isRecord(v) && Array.isArray(v.graphs),
  );
  return body.graphs;
}

/** Shallow shape check for a persisted graph (enough to fail fast on garbage). */
function isInfrastructureGraph(value: unknown): value is InfrastructureGraph {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.schemaVersion === "number" &&
    Array.isArray(value.resources) &&
    Array.isArray(value.relationships) &&
    Array.isArray(value.accounts)
  );
}

/** GET /api/graphs/:id → fetch a full graph. */
export async function getGraph(id: string): Promise<InfrastructureGraph> {
  const res = await fetch(`/api/graphs/${encodeURIComponent(id)}`);
  return parseJson<InfrastructureGraph>(res, isInfrastructureGraph);
}

/** POST /api/graphs → create a graph, returning the persisted entity. */
export async function createGraph(g: InfrastructureGraph): Promise<InfrastructureGraph> {
  const res = await fetch("/api/graphs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(g),
  });
  return parseJson<InfrastructureGraph>(res, isInfrastructureGraph);
}

/** PUT /api/graphs/:id → replace a graph, returning the persisted entity. */
export async function updateGraph(
  id: string,
  g: InfrastructureGraph,
): Promise<InfrastructureGraph> {
  const res = await fetch(`/api/graphs/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(g),
  });
  return parseJson<InfrastructureGraph>(res, isInfrastructureGraph);
}

/** DELETE /api/graphs/:id → remove a graph. */
export async function deleteGraph(id: string): Promise<void> {
  const res = await fetch(`/api/graphs/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!res.ok) await throwError(res);
}

/**
 * Static AWS credentials a user supplies to scan their own account. Sent over
 * HTTPS for a single request and used only in-memory server-side — never stored.
 */
export interface ScanCreds {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

/**
 * POST /api/discover → run a live Cloud Control scan.
 * Pass `creds` to scan with the caller's own credentials (the only option on a
 * hosted deployment). Omit them to use the server's default credential chain —
 * appropriate only for a single-user local deployment.
 */
export async function runDiscovery(opts: {
  region: string;
  types: string[];
  accountId?: string;
  creds?: ScanCreds;
}): Promise<DiscoverResult> {
  const res = await fetch("/api/discover", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts),
  });
  return parseJson<DiscoverResult>(
    res,
    (v): v is DiscoverResult => isRecord(v) && Array.isArray(v.resources),
  );
}

/** A Terraform root module returned by the connect-repo route. */
export interface RepoRoot {
  dir: string;
  name: string;
}

/** Per-root outcome from a repository connect. */
export interface RepoRootReport {
  name: string;
  dir: string;
  strategy: "resolved" | "static" | "failed";
  resourceCount: number;
  note?: string;
}

export interface ConnectRepoResponse {
  graph: InfrastructureGraph;
  roots: RepoRootReport[];
  unmappedTypes: string[];
  warnings: string[];
}

/** POST /api/connect-repo with `detectOnly` → list a repo's Terraform roots. */
export async function detectRepoRoots(path: string): Promise<RepoRoot[]> {
  const res = await fetch("/api/connect-repo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, detectOnly: true }),
  });
  const body = await parseJson<{ roots: RepoRoot[] }>(
    res,
    (v): v is { roots: RepoRoot[] } => isRecord(v) && Array.isArray(v.roots),
  );
  return body.roots;
}

/** POST /api/connect-repo → build a layered graph from a local Terraform repo. */
export async function connectRepo(opts: {
  path: string;
  roots?: string[];
  strategy?: "auto" | "static" | "resolved";
}): Promise<ConnectRepoResponse> {
  const res = await fetch("/api/connect-repo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts),
  });
  return parseJson<ConnectRepoResponse>(
    res,
    (v): v is ConnectRepoResponse => isRecord(v) && isRecord(v.graph) && Array.isArray(v.roots),
  );
}

/**
 * POST /api/discover/gcp → run a live Cloud Asset Inventory scan with the
 * server's ambient Application Default Credentials. `scope` is a
 * "projects/<id>" | "folders/<id>" | "organizations/<id>" string.
 */
export async function runGcpDiscovery(opts: {
  scope: string;
  types: string[];
}): Promise<GcpDiscoverResult> {
  const res = await fetch("/api/discover/gcp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts),
  });
  return parseJson<GcpDiscoverResult>(
    res,
    (v): v is GcpDiscoverResult => isRecord(v) && Array.isArray(v.resources),
  );
}

/**
 * POST /api/discover/azure → run a live Azure Resource Graph scan with the
 * server's ambient DefaultAzureCredential across the given subscription id(s).
 */
export async function runAzureDiscovery(opts: {
  subscriptions: string[];
  types: string[];
}): Promise<AzureDiscoverResult> {
  const res = await fetch("/api/discover/azure", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts),
  });
  return parseJson<AzureDiscoverResult>(
    res,
    (v): v is AzureDiscoverResult => isRecord(v) && Array.isArray(v.resources),
  );
}
