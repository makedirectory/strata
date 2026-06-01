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

/** The portable subset of a graph carried in a share link. */
type SharePayload = Pick<
  InfrastructureGraph,
  "name" | "resources" | "relationships" | "accounts" | "viewport" | "schemaVersion"
>;

/** Encode a graph to the base64url value that goes after `#g=`. */
export function encodeGraph(graph: InfrastructureGraph): string {
  const payload: SharePayload = {
    name: graph.name,
    resources: graph.resources,
    relationships: graph.relationships,
    accounts: graph.accounts,
    viewport: graph.viewport,
    schemaVersion: graph.schemaVersion,
  };
  return toBase64Url(JSON.stringify(payload));
}

/** Build a full shareable URL from a base origin/path and a graph. */
export function buildShareUrl(base: string, graph: InfrastructureGraph): string {
  return `${base}#${SHARE_HASH_KEY}=${encodeGraph(graph)}`;
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
    return parsed as SharePayload;
  } catch {
    return null;
  }
}

/** Read a shared graph from a location hash (e.g. "#g=abc"), or `null`. */
export function readGraphFromHash(hash: string): SharePayload | null {
  const m = /[#&]g=([^&]+)/.exec(hash);
  return m ? decodeGraph(m[1]) : null;
}
