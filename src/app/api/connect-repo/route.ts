/**
 * /api/connect-repo — turn a local Terraform/OpenTofu repo into a graph.
 *   POST { path, detectOnly?, roots?, strategy? }
 *     detectOnly → { roots: TfRoot[] }            (cheap; just classify roots)
 *     otherwise  → ConnectRepoResult              (the layered graph + report)
 *
 * Runs **server-side only** and reads the local filesystem, so it is a
 * single-user / local-dev capability — the same class of exception as
 * `/api/discover`. On a hosted, multi-tenant deployment the server's filesystem
 * is the operator's, so `connectRepo` refuses when `NEXT_PUBLIC_STRATA_HOSTED`
 * is set (surfaced here as a 422).
 *
 * Security: never uses cloud credentials and never mutates the source repo (the
 * resolved strategy runs against a throwaway copy). The response carries only
 * registry-known config, mirroring the discovery route's data hygiene.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "../../../server/auth";
import { connectRepo, detectRepoRoots, type ConnectStrategy } from "../../../server/connectRepo";

export const dynamic = "force-dynamic";

const STRATEGIES: ConnectStrategy[] = ["auto", "static", "resolved"];

interface ConnectBody {
  path: string;
  detectOnly: boolean;
  roots?: string[];
  strategy?: ConnectStrategy;
}

/** Validate the request body to a typed spec, or return null. */
function parseBody(body: unknown): ConnectBody | null {
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
  if (!spec) {
    return NextResponse.json({ error: "Expected { path: string }" }, { status: 422 });
  }

  try {
    if (spec.detectOnly) {
      return NextResponse.json({ roots: await detectRepoRoots(spec.path) });
    }
    const result = await connectRepo(spec.path, { roots: spec.roots, strategy: spec.strategy });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to connect to the repository.";
    // Hosted-disabled and bad-path errors are client-fixable (422); others 500.
    const status =
      /unavailable on hosted|not found|not a directory|required|No .tf|No Terraform/i.test(message)
        ? 422
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
