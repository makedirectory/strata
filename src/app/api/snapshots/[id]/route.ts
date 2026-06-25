/**
 * /api/snapshots/[id] — load or delete one snapshot from the local store.
 *   GET    → the full Snapshot (graph + optional diff)
 *   DELETE → {{ ok: true }}
 * Local-only (see ../route.ts).
 */
import { NextResponse } from "next/server";
import { requireAuth } from "../../../../server/auth";
import { deleteSnapshot, loadSnapshot } from "../../../../server/strataStore";

export const dynamic = "force-dynamic";

function statusFor(message: string): number {
  if (/disabled on hosted/i.test(message)) return 422;
  if (/not found|Invalid snapshot id/i.test(message)) return 404;
  return 500;
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = requireAuth(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  try {
    return NextResponse.json(await loadSnapshot(id));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load snapshot.";
    return NextResponse.json({ error: message }, { status: statusFor(message) });
  }
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = requireAuth(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  try {
    await deleteSnapshot(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete snapshot.";
    return NextResponse.json({ error: message }, { status: statusFor(message) });
  }
}
