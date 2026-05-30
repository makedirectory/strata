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
  const match = /^Bearer (.+)$/.exec(header);
  if (!match || match[1] !== token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
