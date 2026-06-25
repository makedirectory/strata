/**
 * /api/snapshots — list + create diagram snapshots in the local storage folder.
 *   GET  → { snapshots: SnapshotMeta[] }
 *   POST { name, graph, diff?, repo?, root? } → SnapshotMeta
 *
 * Local-only: the store refuses on hosted deployments (localStorage-only there),
 * surfaced here as 422. See `src/server/strataStore.ts`.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "../../../server/auth";
import { listSnapshots, saveSnapshot } from "../../../server/strataStore";
import type { InfrastructureGraph } from "../../../aws/model";

export const dynamic = "force-dynamic";

const statusFor = (m: string) => (/disabled on hosted/i.test(m) ? 422 : 500);

export async function GET(req: Request) {
  const denied = requireAuth(req);
  if (denied) return denied;
  try {
    return NextResponse.json({ snapshots: await listSnapshots() });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to list snapshots.";
    return NextResponse.json({ error: message }, { status: statusFor(message) });
  }
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
  const b = (typeof body === "object" && body ? body : {}) as Record<string, unknown>;
  if (typeof b.name !== "string" || typeof b.graph !== "object" || b.graph === null) {
    return NextResponse.json({ error: "Expected { name, graph }" }, { status: 422 });
  }
  try {
    const meta = await saveSnapshot({
      name: b.name,
      graph: b.graph as InfrastructureGraph,
      diff: b.diff as never,
      repo: typeof b.repo === "string" ? b.repo : undefined,
      root: typeof b.root === "string" ? b.root : undefined,
    });
    return NextResponse.json(meta);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save snapshot.";
    return NextResponse.json({ error: message }, { status: statusFor(message) });
  }
}
