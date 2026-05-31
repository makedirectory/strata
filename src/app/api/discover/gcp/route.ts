/**
 * /api/discover/gcp — live GCP discovery via Cloud Asset Inventory.
 *   POST { scope, types[] } → { resources, scanned, warnings }
 *
 * Server-side only; the single place `@google-cloud/asset` is used (lazily
 * imported so it loads only when a live scan is actually requested). GCP has no
 * "bring-your-own static key" model here — discovery uses the server's **ambient
 * Application Default Credentials** (gcloud login / service-account key /
 * workload identity), appropriate for a single-user LOCAL deployment. On a
 * hosted deployment (`NEXT_PUBLIC_STRATA_HOSTED=1`) ambient scans are rejected;
 * use the Paste-export tab instead.
 *
 * Security invariant: credentials are NEVER persisted, logged, returned, or
 * derived into the response — only non-sensitive asset descriptions.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "../../../../server/auth";
import {
  discoverGcpWithClient,
  type CloudAssetClientLike,
  type CloudAsset,
} from "../../../../gcp/discovery";

export const dynamic = "force-dynamic";

function isHosted(): boolean {
  const v = process.env.NEXT_PUBLIC_STRATA_HOSTED;
  return v === "1" || v === "true";
}

type ScanSpec = { scope: string; types: string[] };

function parseBody(body: unknown): ScanSpec | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  const scope = typeof b.scope === "string" && b.scope.trim() ? b.scope.trim() : null;
  const types = Array.isArray(b.types)
    ? b.types.filter((t): t is string => typeof t === "string" && t.length > 0)
    : [];
  if (!scope || types.length === 0) return null;
  return { scope, types };
}

/** Recursively decode a protobuf `Struct` (`{ fields: {...} }`) to plain JSON. */
function structToPlain(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(structToPlain);
  if (value && typeof value === "object") {
    const v = value as Record<string, unknown>;
    // google.protobuf.Value wrappers.
    if ("structValue" in v) return structToPlain(v.structValue);
    if ("listValue" in v && v.listValue && typeof v.listValue === "object") {
      const lv = v.listValue as { values?: unknown[] };
      return (lv.values ?? []).map(structToPlain);
    }
    if ("stringValue" in v) return v.stringValue;
    if ("numberValue" in v) return v.numberValue;
    if ("boolValue" in v) return v.boolValue;
    if ("nullValue" in v) return null;
    if ("fields" in v && v.fields && typeof v.fields === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, fv] of Object.entries(v.fields as Record<string, unknown>)) {
        out[k] = structToPlain(fv);
      }
      return out;
    }
    const out: Record<string, unknown> = {};
    for (const [k, fv] of Object.entries(v)) out[k] = structToPlain(fv);
    return out;
  }
  return value;
}

/**
 * Adapt the `AssetServiceClient` to our small `CloudAssetClientLike` surface.
 *
 * NOTE: the exact gax return shape (tuple vs async-iterable) and whether
 * `resource.data` arrives as a protobuf Struct or pre-decoded JSON is UNVERIFIED
 * against a live GCP project — both shapes are handled defensively below, and
 * the normalising layer keeps only registry-known config, so an unexpected
 * shape degrades to sparse nodes rather than crashing. Smoke-test once with real
 * Application Default Credentials before relying on it.
 */
async function makeClient(): Promise<CloudAssetClientLike> {
  const { AssetServiceClient } = await import("@google-cloud/asset");
  const client = new AssetServiceClient();
  const toCloudAsset = (a: {
    name?: string | null;
    assetType?: string | null;
    resource?: { data?: unknown; parent?: string | null; location?: string | null } | null;
  }): CloudAsset => ({
    name: a.name ?? undefined,
    assetType: a.assetType ?? undefined,
    resource: {
      data: structToPlain(a.resource?.data) as Record<string, unknown> | undefined,
      parent: a.resource?.parent ?? undefined,
      location: a.resource?.location ?? undefined,
    },
  });
  return {
    async listAssets(scope: string, assetTypes: string[]): Promise<CloudAsset[]> {
      const request = {
        parent: scope,
        contentType: "RESOURCE" as const,
        assetTypes,
        pageSize: 500,
      };
      const result: unknown = await client.listAssets(request);
      // Auto-paginate form returns `[assets, ...]`; tolerate a bare array too.
      const assets = Array.isArray(result)
        ? Array.isArray(result[0])
          ? (result[0] as unknown[])
          : (result as unknown[])
        : [];
      return assets.map((a) => toCloudAsset(a as Parameters<typeof toCloudAsset>[0]));
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
      { error: "Expected { scope: string, types: string[] } (e.g. scope 'projects/my-project')" },
      { status: 422 },
    );
  }
  if (isHosted()) {
    return NextResponse.json(
      { error: "Live GCP scans are disabled on this hosted instance. Use the Paste export tab." },
      { status: 422 },
    );
  }

  try {
    const client = await makeClient();
    const result = await discoverGcpWithClient(client, {
      scope: spec.scope,
      assetTypes: spec.types,
    });
    return NextResponse.json(result);
  } catch (err) {
    const message =
      err instanceof Error && /credential|permission|denied|auth|token/i.test(err.message)
        ? "GCP rejected the request (no Application Default Credentials, or missing permission). Run `gcloud auth application-default login` and retry."
        : "Discovery failed. Check the scope and that the server can reach Cloud Asset Inventory.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
