/**
 * /api/discover — live AWS discovery via the Cloud Control API.
 *   POST { region, types[], accountId? } → { resources, scanned, warnings }
 *
 * This route runs **server-side only** and is the single place the AWS SDK is
 * used. It authenticates with the *ambient* AWS credential chain of the process
 * running this server (env vars / shared profile / SSO) — exactly where a
 * local-first user's credentials already live.
 *
 * Security invariant: credentials are NEVER read into, derived into, returned
 * in, or persisted by this handler. The response carries only non-sensitive
 * resource descriptions (type, identifier, properties, region). The normalising
 * + graph layers keep only registry-known config, so no stray secret property
 * can reach the model either.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "../../../server/auth";
import {
  discoverWithClient,
  type CloudControlLike,
  type CloudControlResourceDescription,
} from "../../../aws/discovery";

export const dynamic = "force-dynamic";

/** Validate the request body to a typed scan spec, or return a 4xx response. */
function parseBody(body: unknown): { region: string; types: string[]; accountId?: string } | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  const region = typeof b.region === "string" && b.region.trim() ? b.region.trim() : null;
  const types = Array.isArray(b.types)
    ? b.types.filter((t): t is string => typeof t === "string" && t.length > 0)
    : [];
  if (!region || types.length === 0) return null;
  const accountId = typeof b.accountId === "string" ? b.accountId : undefined;
  return { region, types, accountId };
}

/**
 * Adapt the AWS SDK `CloudControlClient` to our small `CloudControlLike`
 * surface. The SDK is imported lazily so the dependency only loads when a live
 * scan is actually requested.
 */
async function makeClient(region: string): Promise<CloudControlLike> {
  const { CloudControlClient, ListResourcesCommand } = await import("@aws-sdk/client-cloudcontrol");
  const client = new CloudControlClient({ region });
  return {
    async listResources(typeName: string): Promise<CloudControlResourceDescription[]> {
      const descriptions: CloudControlResourceDescription[] = [];
      let token: string | undefined;
      // Paginate; cap pages defensively so one huge type can't hang the scan.
      for (let page = 0; page < 20; page++) {
        const out = await client.send(
          new ListResourcesCommand({ TypeName: typeName, NextToken: token }),
        );
        for (const d of out.ResourceDescriptions ?? []) {
          descriptions.push({ identifier: d.Identifier, properties: d.Properties });
        }
        token = out.NextToken;
        if (!token) break;
      }
      return descriptions;
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
      { error: "Expected { region: string, types: string[] }" },
      { status: 422 },
    );
  }

  try {
    const client = await makeClient(spec.region);
    const result = await discoverWithClient(client, spec);
    return NextResponse.json(result);
  } catch (err) {
    // Never echo SDK internals/credentials — return a generic, safe message.
    const message =
      err instanceof Error && /credential|token|expired|profile|sso/i.test(err.message)
        ? "AWS credentials unavailable or expired. Configure the server's AWS credentials and retry."
        : "Discovery failed. Check the region and that the server can reach AWS.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
