/**
 * Lightweight, optional bearer-token guard for the graph API.
 * --------------------------------------------------------------
 * The graph routes have no per-user model, so there is nothing to authorize
 * against. To still close the door on unauthenticated access (IDOR) when
 * deployed, this provides an opt-in shared-secret check:
 *
 *   - If `AWS_FLOW_API_TOKEN` is set, every graph route requires an
 *     `Authorization: Bearer <token>` header matching it, else 401.
 *   - If the env var is unset (the default, including tests), the guard is a
 *     no-op and behaviour is unchanged.
 *
 * This is intentionally minimal — swap in real auth (sessions/JWT/OIDC) here if
 * the app ever grows a user model.
 */
import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "crypto";

/**
 * Constant-time string compare. Hashes both inputs to a fixed-length digest so
 * `timingSafeEqual` (which requires equal-length buffers) works regardless of
 * length and the comparison leaks neither the token nor its length via timing.
 */
function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Returns a 401 `NextResponse` when the request fails the optional bearer-token
 * check, or `null` when the request may proceed. Reads the token from the
 * environment on each call so tests can toggle it.
 */
export function requireAuth(req: Request): NextResponse | null {
  const token = process.env.AWS_FLOW_API_TOKEN;
  // Guard disabled: unset or empty token means open access (unchanged default).
  if (!token) return null;

  const header = req.headers.get("authorization") ?? "";
  // Scheme is matched case-insensitively (RFC 7235 auth-scheme is case-insensitive);
  // the token itself is compared exactly, in constant time.
  const match = /^Bearer (.+)$/i.exec(header);
  if (!match || !safeEqual(match[1], token)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
