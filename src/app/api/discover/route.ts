/**
 * /api/discover — live AWS discovery via the Cloud Control API.
 *   POST { region, types[], accountId?, creds? } → { resources, scanned, warnings }
 *
 * This route runs **server-side only** and is the single place the AWS SDK is
 * used. Credentials come from one of two places:
 *
 *   - **User-supplied (bring-your-own):** the request may carry `creds`
 *     (accessKeyId / secretAccessKey / optional sessionToken). These are used
 *     to build the client for this one scan and then discarded — never written
 *     to disk, never logged, never returned.
 *   - **Ambient chain:** with no `creds`, the SDK's default chain (env / shared
 *     profile / SSO / instance role) is used — appropriate for a single-user
 *     LOCAL deployment where the operator's own credentials live on the box.
 *
 * On a HOSTED, multi-tenant deployment the ambient chain would be the
 * *operator's* account, so any visitor could enumerate it. To prevent that, set
 * `NEXT_PUBLIC_STRATA_HOSTED=1`: the ambient fallback is then disabled and a
 * scan without `creds` is rejected (422).
 *
 * Security invariant: credentials are NEVER persisted, logged, returned, or
 * derived into the response. The response carries only non-sensitive resource
 * descriptions (type, identifier, properties, region). The normalising + graph
 * layers keep only registry-known config, so no stray secret property can reach
 * the model either.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "../../../server/auth";
import {
  discoverWithClient,
  type CloudControlLike,
  type CloudControlResourceDescription,
} from "../../../aws/discovery";

export const dynamic = "force-dynamic";

/** True when this instance is a shared/hosted deployment (no ambient-cred fallback). */
function isHosted(): boolean {
  const v = process.env.NEXT_PUBLIC_STRATA_HOSTED;
  return v === "1" || v === "true";
}

/** Static credentials a request may carry to scan the caller's own account. */
type ScanCreds = { accessKeyId: string; secretAccessKey: string; sessionToken?: string };

/**
 * Read `creds` off the body. Returns the validated creds, `undefined` when the
 * field is absent, or the string `"invalid"` when present but malformed (so the
 * caller can 422 rather than silently fall through to the ambient chain).
 */
function parseCreds(raw: unknown): ScanCreds | undefined | "invalid" {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "object") return "invalid";
  const c = raw as Record<string, unknown>;
  const accessKeyId = typeof c.accessKeyId === "string" ? c.accessKeyId.trim() : "";
  const secretAccessKey = typeof c.secretAccessKey === "string" ? c.secretAccessKey.trim() : "";
  if (!accessKeyId || !secretAccessKey) return "invalid";
  const sessionToken =
    typeof c.sessionToken === "string" && c.sessionToken.trim() ? c.sessionToken.trim() : undefined;
  return { accessKeyId, secretAccessKey, sessionToken };
}

type ScanSpec = { region: string; types: string[]; accountId?: string; creds?: ScanCreds };

/** Validate the request body to a typed scan spec, or return a 4xx response. */
function parseBody(body: unknown): ScanSpec | "bad-creds" | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  const region = typeof b.region === "string" && b.region.trim() ? b.region.trim() : null;
  const types = Array.isArray(b.types)
    ? b.types.filter((t): t is string => typeof t === "string" && t.length > 0)
    : [];
  if (!region || types.length === 0) return null;
  const accountId = typeof b.accountId === "string" ? b.accountId : undefined;
  const creds = parseCreds(b.creds);
  if (creds === "invalid") return "bad-creds";
  return { region, types, accountId, creds };
}

/**
 * Adapt the AWS SDK `CloudControlClient` to our small `CloudControlLike`
 * surface. The SDK is imported lazily so the dependency only loads when a live
 * scan is actually requested. When `creds` are supplied they are passed
 * verbatim (and never retained beyond this client); otherwise the SDK's default
 * credential chain is used.
 */
async function makeClient(region: string, creds?: ScanCreds): Promise<CloudControlLike> {
  const { CloudControlClient, ListResourcesCommand } = await import("@aws-sdk/client-cloudcontrol");
  const client = new CloudControlClient({
    region,
    ...(creds
      ? {
          credentials: {
            accessKeyId: creds.accessKeyId,
            secretAccessKey: creds.secretAccessKey,
            sessionToken: creds.sessionToken,
          },
        }
      : {}),
  });
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
  if (spec === "bad-creds") {
    return NextResponse.json(
      { error: "Provide both an access key ID and secret access key." },
      { status: 422 },
    );
  }
  if (!spec) {
    return NextResponse.json(
      { error: "Expected { region: string, types: string[] }" },
      { status: 422 },
    );
  }

  // On a hosted deployment, never scan with the operator's ambient credentials —
  // a visitor must bring their own.
  if (isHosted() && !spec.creds) {
    return NextResponse.json(
      { error: "Enter AWS credentials to run a live scan, or use the Paste export tab." },
      { status: 422 },
    );
  }

  try {
    const client = await makeClient(spec.region, spec.creds);
    const result = await discoverWithClient(client, {
      region: spec.region,
      types: spec.types,
      accountId: spec.accountId,
    });
    return NextResponse.json(result);
  } catch (err) {
    // Never echo SDK internals/credentials — return a generic, safe message.
    const message =
      err instanceof Error && /credential|token|expired|access|denied|signature/i.test(err.message)
        ? "AWS rejected those credentials (wrong, expired, or lacking permission). Check the keys and retry."
        : "Discovery failed. Check the region and that the server can reach AWS.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
