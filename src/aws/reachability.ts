/**
 * Policy-aware reachability analysis — pure, framework-free.
 * ----------------------------------------------------------
 * Evaluates which resources are reachable from the public internet, given the
 * modelled topology (subnet placement, route tables, gateways, load balancers)
 * and the free-text security-group `ingress` config. Unlike the topology-only
 * overlays in `overlays.ts`, this engine reasons about NETWORK SEMANTICS:
 *   - a resource is internet-reachable when it sits in a *public* subnet whose
 *     route table has a default route (0.0.0.0/0 / ::/0, or an unspecified
 *     destination) to an internet-gateway, OR when it is fronted by an
 *     external-facing edge service (internet-gateway, cloudfront, api-gateway,
 *     global-accelerator, or an internet-facing elastic-load-balancer);
 *   - "open ports" are parsed from a security-group's `ingress` free-text
 *     (lines of `<proto> <port> <cidr>`) where the source CIDR is a world CIDR
 *     (0.0.0.0/0 or ::/0). Sensitive ports (22/3389/…) are called out in notes.
 *
 * This module implements its OWN small CIDR math (`ipv4ToInt`, `parseCidr`,
 * `isWorldCidr`) — the CIDR helpers in `rules.ts` are private and must not be
 * imported. Containment/attachment is resolved direction-agnostically, mirroring
 * the local helpers in `rules.ts`, so graphs that model subnet↔route-table or
 * subnet↔resource edges either way round are handled identically.
 *
 * Pure: no DOM, no network, no credentials, deterministic sorted output. Also
 * exports a `litFor`-shaped helper (`litReachable`) so the integrator can plug
 * it into a new `OverlayKind` without this engine depending on `overlays.ts`.
 */
import type { InfrastructureGraph, ResourceInstance, Relationship } from "./model";
import { childrenOf } from "./model";
import type { RelationshipKind } from "./types";

/** A port opened to the world by a security-group ingress rule. */
export interface OpenPort {
  port: number;
  protocol: string;
  cidr: string;
}

/** A resource judged reachable from the public internet. */
export interface ExposedResource {
  resourceId: string;
  serviceId: string;
  name: string;
  /** Human-readable reasons it is exposed (e.g. "public subnet route to IGW"). */
  via: string[];
  /** World-open ports discovered on attached security groups. */
  openPorts: OpenPort[];
}

/** The full reachability picture for a graph. */
export interface ReachabilityResult {
  exposed: ExposedResource[];
  internetReachableIds: Set<string>;
  publicSubnetIds: Set<string>;
  notes: string[];
}

/**
 * `OverlayLit`-shaped lit set (structurally identical to `overlays.ts`'s type,
 * re-declared here so this engine stays decoupled). `externalNodes` carries the
 * internet-reachable resources; `nodes`/`edges` carry the supporting topology.
 */
export interface ReachabilityLit {
  nodes: Set<string>;
  edges: Set<string>;
  externalNodes: Set<string>;
}

// ----- service id constants -------------------------------------------------

const PUBLIC_SUBNET = "subnet-public";
const ROUTE_TABLE = "route-table";
const INTERNET_GATEWAY = "internet-gateway";
const SECURITY_GROUP = "security-group";
const LOAD_BALANCER = "elastic-load-balancer";

/**
 * Edge services that, when they connect to a resource, place that resource on
 * the public-internet front door regardless of subnet placement. The
 * load-balancer is conditional on its `scheme` (see `isExternalEdge`).
 */
const EXTERNAL_EDGE_SERVICES: ReadonlySet<string> = new Set([
  INTERNET_GATEWAY,
  "cloudfront",
  "api-gateway",
  "global-accelerator",
]);

/** Ports that are dangerous to expose to the world (admin/data-plane). */
const SENSITIVE_PORTS: ReadonlySet<number> = new Set([22, 3389, 3306, 5432, 1433, 6379, 27017, 9200]);

// ----- CIDR math (local; rules.ts helpers are private) ----------------------

/** Parse a dotted-quad IPv4 address to a uint32, or `null` if malformed. */
function ipv4ToInt(ip: string): number | null {
  const octets = ip.split(".");
  if (octets.length !== 4) return null;
  let acc = 0;
  for (const part of octets) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    acc = (acc << 8) + n;
  }
  return acc >>> 0;
}

/** Parse a `<ipv4>/<mask>` CIDR, validating the mask is an int in [0, 32]. */
function parseCidr(cidr: string): { net: number; mask: number } | null {
  const [base, maskStr, extra] = cidr.split("/");
  if (extra !== undefined || maskStr === undefined) return null;
  if (!/^\d{1,2}$/.test(maskStr)) return null;
  const mask = Number(maskStr);
  if (mask < 0 || mask > 32) return null;
  const ip = ipv4ToInt(base);
  if (ip === null) return null;
  const hostBits = 32 - mask;
  const maskBits = hostBits === 32 ? 0 : (~0 << hostBits) >>> 0;
  const net = (ip & maskBits) >>> 0;
  return { net, mask };
}

/**
 * True for an "all addresses" CIDR: IPv4 `0.0.0.0/0` or IPv6 `::/0`. A malformed
 * IPv4 CIDR is not treated as world (so a typo surfaces as "not exposed" rather
 * than a false positive); `::/0` is matched textually since this engine does no
 * IPv6 arithmetic.
 */
export function isWorldCidr(cidr: string): boolean {
  const trimmed = cidr.trim();
  if (trimmed === "::/0") return true;
  const parsed = parseCidr(trimmed);
  return parsed !== null && parsed.mask === 0 && parsed.net === 0;
}

// ----- topology helpers (direction-agnostic; mirror rules.ts) ---------------

/**
 * A `routes_to` edge is a *default* route when its destination is a world CIDR
 * or unspecified (back-compat with manually-drawn edges that omit
 * `destinationCidr`). A prefix-specific route does not provide general internet
 * egress.
 */
function isDefaultRoute(e: Relationship): boolean {
  const d = e.destinationCidr;
  if (d === undefined || d === "") return true;
  return isWorldCidr(d);
}

/** Index helpers built once per evaluation. */
interface Index {
  byId: Map<string, ResourceInstance>;
  graph: InfrastructureGraph;
  incoming: (id: string, kind?: RelationshipKind) => Relationship[];
  outgoing: (id: string, kind?: RelationshipKind) => Relationship[];
}

function buildIndex(graph: InfrastructureGraph): Index {
  const byId = new Map(graph.resources.map((r) => [r.id, r]));
  const rels = graph.relationships;
  return {
    byId,
    graph,
    incoming: (id, kind) => rels.filter((e) => e.to === id && (!kind || e.kind === kind)),
    outgoing: (id, kind) => rels.filter((e) => e.from === id && (!kind || e.kind === kind)),
  };
}

/** Neighbours of `id` joined by `kind`, in either edge direction, resolved. */
function neighborsByKind(idx: Index, id: string, kind: RelationshipKind): ResourceInstance[] {
  const out = new Map<string, ResourceInstance>();
  for (const e of idx.incoming(id, kind)) {
    const n = idx.byId.get(e.from);
    if (n) out.set(n.id, n);
  }
  for (const e of idx.outgoing(id, kind)) {
    const n = idx.byId.get(e.to);
    if (n) out.set(n.id, n);
  }
  return [...out.values()];
}

/** True when the resource is an external-facing edge service. */
function isExternalEdge(r: ResourceInstance): boolean {
  if (EXTERNAL_EDGE_SERVICES.has(r.serviceId)) return true;
  if (r.serviceId === LOAD_BALANCER) {
    return String(r.config?.["scheme"] ?? "internet-facing") === "internet-facing";
  }
  return false;
}

/**
 * Subnets a resource is placed in — via `parentId`, or `contains`/`attached_to`
 * edges in either direction, or a child stamped with this resource's id.
 */
function subnetsOf(idx: Index, r: ResourceInstance): ResourceInstance[] {
  const found = new Map<string, ResourceInstance>();
  const add = (n: ResourceInstance | undefined) => {
    if (n && (n.serviceId === PUBLIC_SUBNET || n.serviceId === "subnet-private")) {
      found.set(n.id, n);
    }
  };
  if (r.parentId) add(idx.byId.get(r.parentId));
  for (const n of neighborsByKind(idx, r.id, "contains")) add(n);
  for (const n of neighborsByKind(idx, r.id, "attached_to")) add(n);
  for (const c of childrenOf(idx.graph, r.id)) add(c);
  return [...found.values()];
}

/** The route table associated with a subnet, resolved direction-agnostically. */
function routeTableFor(idx: Index, subnet: ResourceInstance): ResourceInstance | undefined {
  const isRt = (n: ResourceInstance | undefined): n is ResourceInstance =>
    !!n && n.serviceId === ROUTE_TABLE;
  for (const n of neighborsByKind(idx, subnet.id, "attached_to")) if (isRt(n)) return n;
  if (subnet.parentId) {
    const p = idx.byId.get(subnet.parentId);
    if (isRt(p)) return p;
  }
  return childrenOf(idx.graph, subnet.id).find(isRt);
}

/** True when a route table has a default `routes_to` edge to an internet gateway. */
function routeTableReachesIgw(idx: Index, rt: ResourceInstance): boolean {
  return idx.outgoing(rt.id, "routes_to").some((e) => {
    const target = idx.byId.get(e.to);
    return target?.serviceId === INTERNET_GATEWAY && isDefaultRoute(e);
  });
}

/** True when the public subnet has a route table with a default route to an IGW. */
function publicSubnetIsRouted(idx: Index, subnet: ResourceInstance): boolean {
  const rt = routeTableFor(idx, subnet);
  return !!rt && routeTableReachesIgw(idx, rt);
}

/** Security groups attached to a resource, in either edge direction. */
function securityGroupsOf(idx: Index, r: ResourceInstance): ResourceInstance[] {
  return neighborsByKind(idx, r.id, "attached_to").filter((n) => n.serviceId === SECURITY_GROUP);
}

/**
 * Parse a security group's `ingress` free-text into world-open ports. Each line
 * is `<proto> <port> <cidr>`; only lines whose CIDR is a world CIDR count. Port
 * tokens that are ranges/comma-lists are skipped here (a single numeric port is
 * required for a precise `OpenPort`), but they are still surfaced via notes when
 * sensitive (see `evaluateReachability`).
 */
function parseOpenPorts(sg: ResourceInstance): OpenPort[] {
  const ingress = sg.config?.["ingress"];
  if (typeof ingress !== "string" || !ingress) return [];
  const out: OpenPort[] = [];
  for (const raw of ingress.split("\n")) {
    const parts = raw.trim().split(/\s+/);
    if (parts.length < 3) continue;
    const [protocol, portToken, cidr] = parts;
    if (!isWorldCidr(cidr)) continue;
    if (!/^\d+$/.test(portToken)) continue;
    out.push({ port: Number(portToken), protocol, cidr });
  }
  return out;
}

/** Deterministic resource sort: name then id. */
function byNameThenId(a: ExposedResource, b: ExposedResource): number {
  if (a.name !== b.name) return a.name < b.name ? -1 : 1;
  return a.resourceId < b.resourceId ? -1 : a.resourceId > b.resourceId ? 1 : 0;
}

/**
 * Evaluate internet reachability + world-open ports across a graph.
 *
 * A resource is internet-reachable when ANY of:
 *   - it is itself an external-facing edge service (IGW/CloudFront/API-GW/
 *     Global Accelerator/internet-facing ELB);
 *   - it sits in a public subnet that is routed to an IGW (default route);
 *   - it is connected (any edge) to an external-facing edge service.
 *
 * `openPorts` are gathered from attached security groups; a resource with
 * world-open ports but no internet path is NOT marked exposed (its ports are
 * only reachable from inside), though the SG's risky ports still generate notes.
 */
export function evaluateReachability(graph: InfrastructureGraph): ReachabilityResult {
  const idx = buildIndex(graph);
  const notes: string[] = [];

  // Public subnets that are actually routed to an IGW.
  const publicSubnetIds = new Set<string>();
  const routedPublicSubnetIds = new Set<string>();
  for (const r of graph.resources) {
    if (r.serviceId !== PUBLIC_SUBNET) continue;
    publicSubnetIds.add(r.id);
    if (publicSubnetIsRouted(idx, r)) routedPublicSubnetIds.add(r.id);
    else notes.push(`Public subnet "${r.name}" has no default route to an internet gateway.`);
  }

  // External-facing edge resources (front doors).
  const edgeIds = new Set<string>();
  for (const r of graph.resources) if (isExternalEdge(r)) edgeIds.add(r.id);

  const internetReachableIds = new Set<string>();
  const via = new Map<string, Set<string>>();
  const addVia = (id: string, reason: string) => {
    internetReachableIds.add(id);
    const set = via.get(id) ?? new Set<string>();
    set.add(reason);
    via.set(id, set);
  };

  for (const r of graph.resources) {
    // 1) the resource is itself a front door.
    if (edgeIds.has(r.id)) addVia(r.id, "internet-facing edge service");

    // 2) placed in a routed public subnet.
    for (const sn of subnetsOf(idx, r)) {
      if (routedPublicSubnetIds.has(sn.id)) {
        addVia(r.id, `public subnet "${sn.name}" routed to internet gateway`);
      }
    }

    // 3) connected to an external-facing edge service.
    for (const e of idx.incoming(r.id)) {
      if (edgeIds.has(e.from)) {
        addVia(r.id, `fronted by ${idx.byId.get(e.from)?.name ?? e.from}`);
      }
    }
    for (const e of idx.outgoing(r.id)) {
      if (edgeIds.has(e.to)) {
        addVia(r.id, `fronted by ${idx.byId.get(e.to)?.name ?? e.to}`);
      }
    }
  }

  // World-open ports per resource (via attached security groups). Also surface
  // sensitive range/comma port tokens as notes even when not parsed precisely.
  const openByResource = new Map<string, OpenPort[]>();
  for (const r of graph.resources) {
    const ports: OpenPort[] = [];
    for (const sg of securityGroupsOf(idx, r)) {
      for (const p of parseOpenPorts(sg)) {
        ports.push(p);
        if (SENSITIVE_PORTS.has(p.port) && internetReachableIds.has(r.id)) {
          notes.push(
            `"${r.name}" exposes sensitive port ${p.port}/${p.protocol} to the world (${p.cidr}).`,
          );
        }
      }
    }
    if (ports.length > 0) {
      ports.sort((a, b) => a.port - b.port || (a.protocol < b.protocol ? -1 : 1));
      openByResource.set(r.id, ports);
    }
  }

  // Assemble exposed list: a resource is exposed when it is internet-reachable.
  const exposed: ExposedResource[] = [];
  for (const r of graph.resources) {
    if (!internetReachableIds.has(r.id)) continue;
    const reasons = [...(via.get(r.id) ?? new Set<string>())].sort();
    exposed.push({
      resourceId: r.id,
      serviceId: r.serviceId,
      name: r.name,
      via: reasons,
      openPorts: openByResource.get(r.id) ?? [],
    });
  }
  exposed.sort(byNameThenId);

  notes.sort();
  // De-dupe notes deterministically.
  const dedupedNotes = [...new Set(notes)];

  return { exposed, internetReachableIds, publicSubnetIds, notes: dedupedNotes };
}

/**
 * `OverlayLit`-shaped lit set for a "reachability" overlay. `externalNodes` are
 * the internet-reachable resources; `nodes` additionally includes the public
 * subnets / edge services on the path; `edges` are the relationships connecting
 * any two lit nodes. Decoupled from `overlays.ts` — the integrator wires this
 * into a new `OverlayKind`.
 */
export function litReachable(graph: InfrastructureGraph): ReachabilityLit {
  const result = evaluateReachability(graph);
  const idx = buildIndex(graph);

  const externalNodes = new Set(result.internetReachableIds);
  const nodes = new Set(result.internetReachableIds);
  for (const id of result.publicSubnetIds) nodes.add(id);
  // Include the edge services and route tables on each exposed path.
  for (const r of graph.resources) {
    if (isExternalEdge(r)) nodes.add(r.id);
  }

  const edges = new Set<string>();
  for (const e of graph.relationships) {
    if (nodes.has(e.from) && nodes.has(e.to)) edges.add(e.id);
  }

  return { nodes, edges, externalNodes };
}
