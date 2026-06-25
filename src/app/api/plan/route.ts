/**
 * /api/plan — visualise a Terraform/OpenTofu plan as a graph + change diff.
 *   POST { planJson }            → ingest a `terraform show -json` document (no creds)
 *   POST { repoPath, root? }     → run `plan` in the user's repo (local convenience)
 *
 * The `planJson` path is credential-free and the recommended one: generate it in
 * your normal workflow (`terraform plan -out=p && terraform show -json p`). The
 * `repoPath` path runs terraform locally with your ambient creds/backend so the
 * diff reflects real drift; it is local-only and writes the plan file to a temp
 * dir (never the repo) and never applies.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "../../../server/auth";
import { importPlanJson, runRepoPlan } from "../../../server/runPlan";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const denied = requireAuth(req);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const b = (typeof body === "object" && body ? body : {}) as Record<string, unknown>;

  try {
    if (b.planJson !== undefined) {
      const result = importPlanJson(b.planJson, typeof b.name === "string" ? b.name : undefined);
      return NextResponse.json(result);
    }
    if (typeof b.repoPath === "string" && b.repoPath.trim()) {
      const result = await runRepoPlan(b.repoPath.trim(), {
        root: typeof b.root === "string" ? b.root : undefined,
      });
      return NextResponse.json(result);
    }
    return NextResponse.json({ error: "Expected { planJson } or { repoPath }." }, { status: 422 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to read the plan.";
    const status =
      /unavailable on hosted|not found|required|No terraform|Root "|Pass --root|Not a directory/i.test(
        message,
      )
        ? 422
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
