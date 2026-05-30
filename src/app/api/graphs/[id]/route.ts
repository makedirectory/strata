/**
 * /api/graphs/[id] — single graph endpoint.
 *   GET    → fetch full graph
 *   PUT    → replace graph (body: InfrastructureGraph)
 *   DELETE → remove graph
 */
import { NextResponse } from "next/server";
import { getRepository } from "../../../../server";
import { emptyGraph, validateGraph } from "../../../../aws/model";
import {
  hasGraphCollections,
  pickWritableFields,
  checkCollectionLimits,
  checkOptionalFields,
} from "../../../../server/graphSchema";
import { requireAuth } from "../../../../server/auth";
import type { InfrastructureGraph } from "../../../../aws/model";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const denied = requireAuth(req);
  if (denied) return denied;
  const repo = getRepository();
  const graph = await repo.get(params.id);
  if (!graph) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(graph);
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const denied = requireAuth(req);
  if (denied) return denied;
  const repo = getRepository();
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  // Reject bodies missing the required collections (or with wrong-typed ones)
  // before treating them as a graph — otherwise undefined/garbage fields would
  // be persisted as silent data loss or crash downstream.
  if (!hasGraphCollections(body)) {
    return NextResponse.json({ error: "Invalid graph: missing required fields" }, { status: 422 });
  }
  // Whitelist incoming fields so unexpected/extra/server-owned keys
  // (id, schemaVersion, timestamps) can't be persisted via the raw body.
  const fields = pickWritableFields(body as Record<string, unknown>);
  // Reject wrong-typed optional fields (description / viewport) as 422.
  const optionalError = checkOptionalFields(body as Record<string, unknown>);
  if (optionalError) return NextResponse.json({ error: optionalError }, { status: 422 });
  // The repository re-stamps id/schemaVersion/timestamps, so fill defaults for
  // any optional fields the client omitted before structural validation.
  const graph: InfrastructureGraph = { ...emptyGraph(body.name), ...fields };
  // Bound payload size before persisting an arbitrarily large graph.
  const limitError = checkCollectionLimits(graph);
  if (limitError) return NextResponse.json({ error: limitError }, { status: 413 });
  const errors = validateGraph(graph);
  if (errors.length)
    return NextResponse.json({ error: "Invalid graph", details: errors }, { status: 422 });
  const updated = await repo.update(params.id, graph);
  if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(updated);
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const denied = requireAuth(req);
  if (denied) return denied;
  const repo = getRepository();
  const ok = await repo.remove(params.id);
  if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
