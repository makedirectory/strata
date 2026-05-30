/**
 * /api/graphs — collection endpoint.
 *   GET  → list graph summaries
 *   POST → create a new graph (body: InfrastructureGraph)
 */
import { NextResponse } from "next/server";
import { getRepository } from "../../../server";
import { emptyGraph, validateGraph } from "../../../aws/model";
import {
  pickWritableFields,
  checkCollectionLimits,
  checkOptionalFields,
} from "../../../server/graphSchema";
import { requireAuth } from "../../../server/auth";
import type { InfrastructureGraph } from "../../../aws/model";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = requireAuth(req);
  if (denied) return denied;
  const repo = getRepository();
  const summaries = await repo.list();
  return NextResponse.json({ graphs: summaries });
}

export async function POST(req: Request) {
  const denied = requireAuth(req);
  if (denied) return denied;
  const repo = getRepository();
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid graph: expected an object body" }, { status: 422 });
  }
  // Whitelist incoming fields so unexpected/wrong-typed keys can't override the
  // emptyGraph defaults; validateGraph then verifies structural integrity.
  const fields = pickWritableFields(body as Record<string, unknown>);
  // Reject collections supplied with the wrong type (e.g. resources: "x") here
  // as a 422 rather than letting them crash downstream as a 500.
  for (const key of ["accounts", "resources", "relationships"] as const) {
    if (key in fields && !Array.isArray(fields[key])) {
      return NextResponse.json(
        { error: `Invalid graph: ${key} must be an array` },
        { status: 422 },
      );
    }
  }
  // Reject wrong-typed optional fields (description / viewport) as 422.
  const optionalError = checkOptionalFields(body as Record<string, unknown>);
  if (optionalError) return NextResponse.json({ error: optionalError }, { status: 422 });
  const name = typeof fields.name === "string" ? fields.name : "Untitled Architecture";
  const graph: InfrastructureGraph = { ...emptyGraph(name), ...fields };
  // Bound payload size before persisting an arbitrarily large graph.
  const limitError = checkCollectionLimits(graph);
  if (limitError) return NextResponse.json({ error: limitError }, { status: 413 });
  const errors = validateGraph(graph);
  if (errors.length)
    return NextResponse.json({ error: "Invalid graph", details: errors }, { status: 422 });
  const created = await repo.create(graph);
  return NextResponse.json(created, { status: 201 });
}
