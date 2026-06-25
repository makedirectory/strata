/**
 * /api/connect-repo — turn a local Terraform/OpenTofu repo into a graph.
 *   POST { path, detectOnly?, roots?, strategy? }
 *     detectOnly → { roots }            (cheap; just classify roots)
 *     otherwise  → ConnectRepoResult    (the layered graph + report)
 *
 * Local-only (reads the filesystem, may run terraform). Disabled on hosted
 * deployments — `connectRepo`/`detectRepoRoots` refuse via the repoFs hosted
 * guard, surfaced here as 422. Never uses cloud credentials; never mutates the
 * source repo (resolved strategy runs against a throwaway copy).
 */
import { NextResponse } from "next/server";
import { requireAuth } from "../../../server/auth";
import { connectRepo, detectRepoRoots, type ConnectStrategy } from "../../../server/connectRepo";

export const dynamic = "force-dynamic";

const STRATEGIES: ConnectStrategy[] = ["auto", "static", "resolved"];

function parseBody(body: unknown) {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  const path = typeof b.path === "string" && b.path.trim() ? b.path.trim() : null;
  if (!path) return null;
  const roots = Array.isArray(b.roots)
    ? b.roots.filter((r): r is string => typeof r === "string" && r.length > 0)
    : undefined;
  const strategy =
    typeof b.strategy === "string" && STRATEGIES.includes(b.strategy as ConnectStrategy)
      ? (b.strategy as ConnectStrategy)
      : undefined;
  return { path, detectOnly: b.detectOnly === true, roots, strategy };
}

/** Client-fixable errors → 422; unexpected → 500. */
function statusFor(message: string): number {
  return /unavailable on hosted|not found|not a directory|required|No \.tf|No Terraform|None of/i.test(
    message,
  )
    ? 422
    : 500;
}

export async function POST(req: Request) {
  const denied = requireAuth(req);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const spec = parseBody(body);
  if (!spec) return NextResponse.json({ error: "Expected { path: string }" }, { status: 422 });

  try {
    if (spec.detectOnly) return NextResponse.json({ roots: await detectRepoRoots(spec.path) });
    const result = await connectRepo(spec.path, { roots: spec.roots, strategy: spec.strategy });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to connect to the repository.";
    return NextResponse.json({ error: message }, { status: statusFor(message) });
  }
}
