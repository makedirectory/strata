/**
 * Browser fetch client for the graph REST API (`/api/graphs`).
 *
 * Thin typed wrappers around the route handlers in
 * `src/app/api/graphs/route.ts` and `src/app/api/graphs/[id]/route.ts`.
 * Each helper throws an Error carrying the server-provided `{ error }`
 * message (falling back to the HTTP status text) on a non-ok response.
 */
import type { InfrastructureGraph, GraphSummary } from "../aws/model";

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
