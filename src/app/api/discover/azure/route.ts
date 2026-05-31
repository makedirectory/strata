/**
 * /api/discover/azure — live Azure discovery via Azure Resource Graph.
 *   POST { subscriptions[], types[] } → { resources, scanned, warnings }
 *
 * Server-side only; the single place `@azure/arm-resourcegraph` + `@azure/identity`
 * are used (lazily imported so they load only when a live scan is requested).
 * Discovery uses the server's **ambient DefaultAzureCredential** (Azure CLI
 * login / managed identity / env), appropriate for a single-user LOCAL
 * deployment. On a hosted deployment (`NEXT_PUBLIC_STRATA_HOSTED=1`) ambient
 * scans are rejected; use the Paste-export tab instead.
 *
 * Security invariant: credentials/tokens are NEVER persisted, logged, returned,
 * or derived into the response — only non-sensitive resource descriptions.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "../../../../server/auth";
import { discoverAzureWithClient, type ResourceGraphClientLike } from "../../../../azure/discovery";

export const dynamic = "force-dynamic";

function isHosted(): boolean {
  const v = process.env.NEXT_PUBLIC_STRATA_HOSTED;
  return v === "1" || v === "true";
}

type ScanSpec = { subscriptions: string[]; types: string[] };

function parseBody(body: unknown): ScanSpec | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  const subscriptions = Array.isArray(b.subscriptions)
    ? b.subscriptions.filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    : [];
  const types = Array.isArray(b.types)
    ? b.types.filter((t): t is string => typeof t === "string" && t.length > 0)
    : [];
  if (subscriptions.length === 0) return null;
  return { subscriptions, types };
}

/**
 * Adapt `ResourceGraphClient` to our small `ResourceGraphClientLike` surface.
 *
 * NOTE: the `client.resources(...)` response shape (`.data` rows + `.skipToken`)
 * is UNVERIFIED against a live Azure tenant; `.data` is read defensively and a
 * missing field just ends pagination. Smoke-test once with `az login` before
 * relying on it.
 */
async function makeClient(): Promise<ResourceGraphClientLike> {
  const { ResourceGraphClient } = await import("@azure/arm-resourcegraph");
  const { DefaultAzureCredential } = await import("@azure/identity");
  const client = new ResourceGraphClient(new DefaultAzureCredential());
  return {
    async query(kql: string, subscriptions: string[]): Promise<Record<string, unknown>[]> {
      const rows: Record<string, unknown>[] = [];
      let skipToken: string | undefined;
      // Paginate via skipToken; cap pages defensively.
      for (let page = 0; page < 20; page++) {
        const res = await client.resources(
          { subscriptions, query: kql, options: skipToken ? { skipToken } : undefined },
          {},
        );
        const data = Array.isArray(res.data) ? (res.data as Record<string, unknown>[]) : [];
        rows.push(...data);
        skipToken = typeof res.skipToken === "string" && res.skipToken ? res.skipToken : undefined;
        if (!skipToken) break;
      }
      return rows;
    },
  };
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
    return NextResponse.json(
      { error: "Expected { subscriptions: string[], types?: string[] }" },
      { status: 422 },
    );
  }
  if (isHosted()) {
    return NextResponse.json(
      { error: "Live Azure scans are disabled on this hosted instance. Use the Paste export tab." },
      { status: 422 },
    );
  }

  try {
    const client = await makeClient();
    const result = await discoverAzureWithClient(client, {
      subscriptions: spec.subscriptions,
      types: spec.types,
    });
    return NextResponse.json(result);
  } catch (err) {
    const message =
      err instanceof Error && /credential|permission|denied|auth|token/i.test(err.message)
        ? "Azure rejected the request (no DefaultAzureCredential, or missing permission). Run `az login` and retry."
        : "Discovery failed. Check the subscription id(s) and that the server can reach Resource Graph.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
