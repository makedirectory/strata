/**
 * Shareable-link codec — encode a diagram into a URL fragment, no backend.
 *
 * The graph (a compact subset) is JSON-encoded and base64url-packed into the URL
 * hash (`#g=…`). The fragment is never sent to a server, so this is a pure
 * client-side share: open the link and the diagram loads read-to-edit. Best for
 * reasonably-sized diagrams — very large graphs make long URLs (no compression
 * dependency is pulled in for this).
 *
 * Portable across browser + Node/jsdom: uses TextEncoder/TextDecoder + btoa/atob
 * via a binary-string bridge (no Buffer, no spread-overflow on big inputs).
 */
import type { InfrastructureGraph } from "../aws/model";
import { isAnnotation, isSafeAnnotationColor, type Annotation } from "../aws/annotations";

export const SHARE_HASH_KEY = "g";

function bytesToBinary(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
}
function binaryToBytes(bin: string): Uint8Array {
  const a = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
  return a;
}

function toBase64Url(json: string): string {
  const b64 = btoa(bytesToBinary(new TextEncoder().encode(json)));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromBase64Url(b64url: string): string {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  return new TextDecoder().decode(binaryToBytes(atob(b64)));
}

/** The portable subset of a graph carried in a share link. The presentation-only
 *  annotation layer rides on the graph (`AnnotationGraph` extension), so it is
 *  carried here as an extra optional field rather than via the core `Pick<>`. */
type SharePayload = Pick<
  InfrastructureGraph,
  "name" | "resources" | "relationships" | "accounts" | "viewport" | "schemaVersion"
> & {
  annotations?: Annotation[];
};

/** Encode a graph to the base64url value that goes after `#g=`. */
export function encodeGraph(graph: InfrastructureGraph): string {
  // Annotations live on the graph via the AnnotationGraph extension; read them
  // off without coupling shareLink to that engine's full type.
  const annotations = (graph as { annotations?: Annotation[] }).annotations;
  const payload: SharePayload = {
    name: graph.name,
    resources: graph.resources,
    relationships: graph.relationships,
    accounts: graph.accounts,
    viewport: graph.viewport,
    schemaVersion: graph.schemaVersion,
    ...(Array.isArray(annotations) ? { annotations } : {}),
  };
  return toBase64Url(JSON.stringify(payload));
}

/** Build a full shareable URL from a base origin/path and a graph. */
export function buildShareUrl(base: string, graph: InfrastructureGraph): string {
  return `${base}#${SHARE_HASH_KEY}=${encodeGraph(graph)}`;
}

/**
 * Strip an unsafe `color` from a decoded annotation. The annotation is kept
 * intact; only an untrusted, non-allow-listed `color` is removed so it never
 * enters the graph (and thus never reaches a CSS custom property / SVG stroke).
 */
function sanitizeAnnotationColor(annotation: Annotation): Annotation {
  if (annotation.color !== undefined && !isSafeAnnotationColor(annotation.color)) {
    const { color: _color, ...rest } = annotation;
    void _color;
    return rest;
  }
  return annotation;
}

/** Decode a base64url value back into a partial graph, or `null` if invalid. */
export function decodeGraph(value: string): SharePayload | null {
  try {
    const parsed: unknown = JSON.parse(fromBase64Url(value));
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !Array.isArray((parsed as SharePayload).resources) ||
      !Array.isArray((parsed as SharePayload).relationships)
    ) {
      return null;
    }
    const payload = parsed as SharePayload;
    // Defensively validate the annotation layer: keep only well-formed entries
    // (drop malformed ones) so a tampered/old link never injects bad shapes.
    // The `color` is decoded from an untrusted link and later injected into a
    // CSS custom property / SVG stroke; if it is present but NOT a safe color,
    // drop ONLY the `color` field (keep the annotation) so a malicious value
    // never reaches the DOM.
    const rawAnnotations = (payload as { annotations?: unknown }).annotations;
    if (rawAnnotations !== undefined) {
      payload.annotations = Array.isArray(rawAnnotations)
        ? rawAnnotations.filter(isAnnotation).map(sanitizeAnnotationColor)
        : [];
    }
    return payload;
  } catch {
    return null;
  }
}

/** Read a shared graph from a location hash (e.g. "#g=abc"), or `null`. */
export function readGraphFromHash(hash: string): SharePayload | null {
  const m = /[#&]g=([^&]+)/.exec(hash);
  return m ? decodeGraph(m[1]) : null;
}
