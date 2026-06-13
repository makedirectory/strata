/**
 * /api/interest — operator notification for "coming soon" interest signals.
 *   POST { feature, note? } → 204
 *
 * Backend-free and dependency-free: there's no datastore. When a visitor on a
 * hosted deployment clicks "I'd use this", the client posts here and the route:
 *
 *   1. **logs** a structured line (always) — captured by the host's function
 *      logs (e.g. Vercel), so the signal is recorded even with nothing else set;
 *   2. **forwards** a short message to `STRATA_INTEREST_WEBHOOK` when that env var
 *      is set — an incoming webhook (Slack / Discord / ntfy.sh / a webhook→email
 *      relay) gives a real push/email with no npm dependency and no infra. The
 *      body sends both `text` (Slack) and `content` (Discord) so one URL works
 *      for either.
 *
 * It is intentionally unauthenticated (any visitor can express interest) but
 * accepts only a tiny, validated payload — no credentials, no persistence.
 */
import { NextResponse } from "next/server";

interface InterestBody {
  feature: string;
  note?: string;
}

/** Validate the tiny payload, rejecting anything oversized or malformed. */
function parse(body: unknown): InterestBody | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const feature = typeof b.feature === "string" ? b.feature.trim() : "";
  if (!feature || feature.length > 64 || !/^[\w-]+$/.test(feature)) return null;
  const note = typeof b.note === "string" ? b.note.slice(0, 500) : undefined;
  return { feature, note };
}

export async function POST(req: Request) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const payload = parse(raw);
  if (!payload) {
    return NextResponse.json({ error: "Expected { feature, note? }." }, { status: 400 });
  }

  const { feature, note } = payload;
  // Always log — the zero-config record (visible in the host's function logs).
  console.log(`[interest] feature=${feature}${note ? ` note=${JSON.stringify(note)}` : ""}`);

  const webhook = process.env.STRATA_INTEREST_WEBHOOK;
  if (webhook) {
    const text = `🔔 Strata interest: *${feature}*${note ? ` — ${note}` : ""}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    try {
      await fetch(webhook, {
        method: "POST",
        headers: { "content-type": "application/json" },
        // `text` → Slack, `content` → Discord; ntfy.sh reads the raw body too.
        body: JSON.stringify({ text, content: text }),
        signal: controller.signal,
      });
    } catch {
      // Never fail the user's action because the operator's webhook is down.
    } finally {
      clearTimeout(timeout);
    }
  }

  return new NextResponse(null, { status: 204 });
}
