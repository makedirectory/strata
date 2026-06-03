/**
 * Validation autofix — detect mechanically-fixable misconfigurations in a graph
 * and apply a single fix to produce a NEW graph.
 * ------------------------------------------------------------------------------
 * Pure and framework-free. This engine deliberately re-implements the small
 * amount of topology/CIDR detection it needs (security-group ingress parsing,
 * world-CIDR check, subnet/route-table resolution) RATHER than depending on
 * `rules.ts` ValidationResult message strings — fixes must self-detect their
 * trigger condition from config/topology so a wording change in `rules.ts`
 * never silently disables a fix. The detection here intentionally mirrors the
 * shape of the checks in `rules.ts` (sensitive ports, default routes,
 * encryption-at-rest flags, NAT placement) without importing its privates.
 *
 * `applyFix` NEVER mutates its input: it deep-clones the resources/relationships
 * it touches and returns a brand-new `InfrastructureGraph`, so the caller's
 * undo history stays intact. An unknown `fixId` is a safe no-op returning the
 * input graph unchanged.
 *
 * Scope: detection + transformation of the graph data model only. No DOM,
 * network, credentials, or persistence.
 */
import type { InfrastructureGraph, ResourceInstance, Relationship } from "./model";
import { childrenOf } from "./model";

/** The kinds of automatic fix this engine can detect and apply. */
export type FixKind =
  | "close-open-sg"
  | "add-igw-default-route"
  | "enable-storage-encryption"
  | "move-nat-to-public-subnet";

/**
 * A detected, applyable fix. `id` is deterministic (`${kind}:${resourceId}`) so
 * the same graph always yields the same fix ids — stable for UI keys and for
 * passing back into `applyFix`.
 */
export interface Fixable {
  id: string;
  kind: FixKind;
  /** The resource the fix is anchored to (the one whose data/edges change). */
  resourceId: string;
  /** Short human title for the action. */
  title: string;
  /** Longer explanation of what applying the fix will do. */
  detail: string;
}

// ---- service id constants (mirror rules.ts) --------------------------------

const SECURITY_GROUP = "security-group";
const ROUTE_TABLE = "route-table";
const INTERNET_GATEWAY = "internet-gateway";
const NAT_GATEWAY = "nat-gateway";
const SUBNET_PUBLIC = "subnet-public";
const SUBNET_PRIVATE = "subnet-private";
const VPC = "vpc";

/** Resource serviceId -> the boolean config key that flags storage encryption. */
const ENCRYPTION_KEYS: Readonly<Record<string, string>> = {
  "ebs-volume": "encrypted",
  efs: "encrypted",
  rds: "storageEncrypted",
  documentdb: "storageEncrypted",
  neptune: "storageEncrypted",
};

/** Sensitive ingress ports that must not be open to the world. */
const SENSITIVE_PORTS: ReadonlySet<number> = new Set([22, 3389, 3306, 5432, 1433, 6379]);

/** Replacement CIDR written into an over-open security-group ingress rule. */
const PLACEHOLDER_CIDR = "10.0.0.0/8";

// ---- small local helpers ---------------------------------------------------

/** True when a CIDR is an all-addresses (world) route/source. */
function isWorldCidr(cidr: string): boolean {
  return cidr === "0.0.0.0/0" || cidr === "::/0";
}

/**
 * A `routes_to` edge is a *default* route when its destination is the
 * all-addresses CIDR — or unspecified, which we treat as a default route for
 * back-compat with manually-drawn edges that omit `destinationCidr`.
 */
function isDefaultRoute(e: Relationship): boolean {
  const d = e.destinationCidr;
  return d === undefined || d === "" || d === "0.0.0.0/0" || d === "::/0";
}

/** Read a non-empty string config value, else `undefined`. */
function cfgStr(r: ResourceInstance, key: string): string | undefined {
  const v = r.config[key];
  return typeof v === "string" && v ? v : undefined;
}

/** Does a port token (`22`, `22-3389`, `80,3306`) cover a sensitive port? */
function portTokenIsSensitive(token: string): boolean {
  if (/^\d+$/.test(token)) return SENSITIVE_PORTS.has(Number(token));
  if (/^\d+-\d+$/.test(token)) {
    const [lo, hi] = token.split("-").map(Number);
    for (const p of SENSITIVE_PORTS) if (p >= lo && p <= hi) return true;
    return false;
  }
  if (token.includes(",")) {
    return token.split(",").some((t) => portTokenIsSensitive(t.trim()));
  }
  return false;
}

/**
 * True when a security-group `ingress` free-text exposes a sensitive port to
 * the world. The text is one rule per line, each `<proto> <port> <cidr>`.
 */
function sgHasOpenSensitiveLine(sg: ResourceInstance): boolean {
  const ingress = cfgStr(sg, "ingress");
  if (!ingress) return false;
  return ingress.split("\n").some((line) => {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 3) return false;
    const [, port, cidr] = parts;
    return isWorldCidr(cidr) && portTokenIsSensitive(port);
  });
}

/**
 * Rewrite every over-open sensitive ingress line's CIDR to the placeholder
 * private range, preserving all other lines/whitespace verbatim. Returns the
 * new ingress text (idempotent: re-running finds nothing to change).
 */
function tightenIngress(ingress: string): string {
  return ingress
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      const parts = trimmed.split(/\s+/);
      if (parts.length < 3) return line;
      const [proto, port, cidr] = parts;
      if (isWorldCidr(cidr) && portTokenIsSensitive(port)) {
        // Re-emit with single-space separators; the per-line free-text format
        // is whitespace-delimited, so this stays parseable.
        return [proto, port, PLACEHOLDER_CIDR, ...parts.slice(3)].join(" ");
      }
      return line;
    })
    .join("\n");
}

// ---- topology resolution (direction-agnostic, mirrors rules.ts) ------------

interface Topo {
  get: (id: string) => ResourceInstance | undefined;
  /** All subnets a resource is placed in (parentId / contains / attached_to). */
  subnetsOf: (r: ResourceInstance) => ResourceInstance[];
  /** The route table associated with a subnet, either edge direction. */
  routeTableFor: (sn: ResourceInstance) => ResourceInstance | undefined;
  /**
   * The VPC a resource belongs to, resolved via the parent chain plus
   * contains/attached_to edges (either direction). For a route table or NAT
   * that sits in a subnet, this walks subnet → VPC; for an IGW it follows its
   * `attached_to` VPC edge. Returns `undefined` when no enclosing VPC is found.
   */
  vpcOf: (r: ResourceInstance) => ResourceInstance | undefined;
}

function buildTopo(graph: InfrastructureGraph): Topo {
  const rels = graph.relationships;
  const get = (id: string) => graph.resources.find((r) => r.id === id);
  const incoming = (id: string, kind: Relationship["kind"]) =>
    rels.filter((e) => e.to === id && e.kind === kind);
  const outgoing = (id: string, kind: Relationship["kind"]) =>
    rels.filter((e) => e.from === id && e.kind === kind);

  const isSubnet = (r: ResourceInstance | undefined): r is ResourceInstance =>
    !!r && (r.serviceId === SUBNET_PUBLIC || r.serviceId === SUBNET_PRIVATE);
  const isRouteTable = (r: ResourceInstance | undefined): r is ResourceInstance =>
    !!r && r.serviceId === ROUTE_TABLE;

  const subnetsOf = (r: ResourceInstance): ResourceInstance[] => {
    const found = new Map<string, ResourceInstance>();
    if (r.parentId) {
      const p = get(r.parentId);
      if (isSubnet(p)) found.set(p.id, p);
    }
    const collect = (list: (ResourceInstance | undefined)[]) => {
      for (const n of list) if (isSubnet(n)) found.set(n.id, n);
    };
    collect(incoming(r.id, "contains").map((e) => get(e.from)));
    collect(outgoing(r.id, "contains").map((e) => get(e.to)));
    collect(incoming(r.id, "attached_to").map((e) => get(e.from)));
    collect(outgoing(r.id, "attached_to").map((e) => get(e.to)));
    for (const c of childrenOf(graph, r.id)) if (isSubnet(c)) found.set(c.id, c);
    return [...found.values()];
  };

  const routeTableFor = (sn: ResourceInstance): ResourceInstance | undefined =>
    incoming(sn.id, "attached_to")
      .map((e) => get(e.from))
      .find(isRouteTable) ??
    outgoing(sn.id, "attached_to")
      .map((e) => get(e.to))
      .find(isRouteTable) ??
    (sn.parentId && isRouteTable(get(sn.parentId)) ? get(sn.parentId) : undefined) ??
    childrenOf(graph, sn.id).find(isRouteTable);

  const isVpc = (r: ResourceInstance | undefined): r is ResourceInstance =>
    !!r && r.serviceId === VPC;

  /** Direct VPC neighbours of `r` via parentId / contains / attached_to (either way). */
  const directVpc = (r: ResourceInstance): ResourceInstance | undefined => {
    if (r.parentId) {
      const p = get(r.parentId);
      if (isVpc(p)) return p;
    }
    const candidates = [
      ...incoming(r.id, "contains").map((e) => get(e.from)),
      ...outgoing(r.id, "contains").map((e) => get(e.to)),
      ...incoming(r.id, "attached_to").map((e) => get(e.from)),
      ...outgoing(r.id, "attached_to").map((e) => get(e.to)),
    ];
    return candidates.find(isVpc);
  };

  const vpcOf = (r: ResourceInstance): ResourceInstance | undefined => {
    // Direct enclosing VPC (parent / contains / attached_to).
    const direct = directVpc(r);
    if (direct) return direct;
    // Otherwise resolve via the subnet(s) the resource sits in (route tables,
    // NAT gateways, etc. live in a subnet which lives in a VPC).
    for (const sn of subnetsOf(r)) {
      const v = directVpc(sn);
      if (v) return v;
    }
    return undefined;
  };

  return { get, subnetsOf, routeTableFor, vpcOf };
}

/** True when a route table has a default `routes_to` edge to an internet gateway. */
function rtRoutesToIgw(graph: InfrastructureGraph, rt: ResourceInstance, topo: Topo): boolean {
  return graph.relationships.some(
    (e) =>
      e.from === rt.id &&
      e.kind === "routes_to" &&
      topo.get(e.to)?.serviceId === INTERNET_GATEWAY &&
      isDefaultRoute(e),
  );
}

/**
 * The internet gateway in the SAME VPC as `rt`, resolved via the parent chain.
 * Returns `undefined` when the route table's VPC is unknown or that VPC has no
 * IGW (the caller falls back to the first IGW globally and notes the
 * assumption). Determinism: lowest IGW id wins among same-VPC candidates.
 */
function igwForRouteTable(
  graph: InfrastructureGraph,
  topo: Topo,
  rt: ResourceInstance,
): ResourceInstance | undefined {
  const vpc = topo.vpcOf(rt);
  if (!vpc) return undefined;
  return graph.resources
    .filter((r) => r.serviceId === INTERNET_GATEWAY && topo.vpcOf(r)?.id === vpc.id)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0];
}

/**
 * A public subnet in the SAME VPC as `nat`, resolved via the parent chain.
 * `subnet` is the chosen target (lowest subnet id among same-VPC candidates);
 * it is `undefined` when no scoped subnet exists (the caller falls back to the
 * first public subnet globally and notes the assumption).
 */
function publicSubnetForNat(
  graph: InfrastructureGraph,
  topo: Topo,
  nat: ResourceInstance,
): { subnet: ResourceInstance | undefined } {
  const vpc = topo.vpcOf(nat);
  if (vpc) {
    const scoped = graph.resources
      .filter((r) => r.serviceId === SUBNET_PUBLIC && topo.vpcOf(r)?.id === vpc.id)
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0];
    if (scoped) return { subnet: scoped };
  }
  return { subnet: undefined };
}

// ---- detection --------------------------------------------------------------

/**
 * Detect every mechanically-fixable condition in `graph`. Output order is
 * stable (grouped by kind in declaration order, then by resourceId) so the
 * fix list is deterministic across runs.
 */
export function detectFixes(graph: InfrastructureGraph): Fixable[] {
  const topo = buildTopo(graph);
  const out: Fixable[] = [];

  // (1) close-open-sg: a security group with a sensitive port open to the world.
  for (const sg of graph.resources.filter((r) => r.serviceId === SECURITY_GROUP)) {
    if (sgHasOpenSensitiveLine(sg)) {
      out.push({
        id: `close-open-sg:${sg.id}`,
        kind: "close-open-sg",
        resourceId: sg.id,
        title: `Restrict open ports on "${sg.name}"`,
        detail: `Security Group "${sg.name}" exposes a sensitive port to 0.0.0.0/0. Apply to rewrite the source CIDR to a private range (${PLACEHOLDER_CIDR}).`,
      });
    }
  }

  // (2) add-igw-default-route: a public subnet whose route table lacks a default
  // route to an internet gateway, where an internet gateway exists to route to.
  // The IGW is scoped to the SAME VPC as the route table (a global "first IGW"
  // would be wrong in multi-VPC graphs); when the route table's VPC can't be
  // determined we fall back to the first IGW and state the assumption. The same
  // route table can back several public subnets — de-duplicate by fix id so it
  // is only emitted once.
  const anyIgw = graph.resources.find((r) => r.serviceId === INTERNET_GATEWAY);
  if (anyIgw) {
    const emittedIgwFixIds = new Set<string>();
    for (const sn of graph.resources.filter((r) => r.serviceId === SUBNET_PUBLIC)) {
      const rt = topo.routeTableFor(sn);
      if (!rt || rtRoutesToIgw(graph, rt, topo)) continue;
      const id = `add-igw-default-route:${rt.id}`;
      if (emittedIgwFixIds.has(id)) continue;
      emittedIgwFixIds.add(id);
      // `scoped` (note suppression) is true only when the chosen IGW genuinely
      // belongs to the route table's VPC. A cross-VPC fallback (no same-VPC IGW)
      // still emits the assumption note, even when the RT's VPC IS resolved.
      const sameVpcIgw = igwForRouteTable(graph, topo, rt);
      const igw = sameVpcIgw ?? anyIgw;
      const scoped = sameVpcIgw !== undefined;
      const assumption = scoped
        ? ""
        : ` No Internet Gateway was found in this route table's VPC, so the first available Internet Gateway is assumed.`;
      out.push({
        id,
        kind: "add-igw-default-route",
        resourceId: rt.id,
        title: `Add internet route to "${rt.name}"`,
        detail: `Route Table "${rt.name}" (public subnet "${sn.name}") has no default route to an Internet Gateway. Apply to add a 0.0.0.0/0 route to "${igw.name}".${assumption}`,
      });
    }
  }

  // (3) enable-storage-encryption: a resource with an explicit unencrypted flag.
  for (const [serviceId, key] of Object.entries(ENCRYPTION_KEYS)) {
    for (const r of graph.resources.filter((x) => x.serviceId === serviceId)) {
      if (r.config[key] === false) {
        out.push({
          id: `enable-storage-encryption:${r.id}`,
          kind: "enable-storage-encryption",
          resourceId: r.id,
          title: `Enable encryption on "${r.name}"`,
          detail: `${r.name} stores data at rest unencrypted (${key}=false). Apply to set ${key}=true.`,
        });
      }
    }
  }

  // (4) move-nat-to-public-subnet: a NAT gateway not in a public subnet, where a
  // public subnet exists to move it into. The target public subnet is scoped to
  // the SAME VPC as the NAT (a global "first public subnet" would be wrong in
  // multi-VPC graphs); when the NAT's VPC can't be determined we fall back to
  // the first public subnet and state the assumption.
  const hasPublicSubnet = graph.resources.some((r) => r.serviceId === SUBNET_PUBLIC);
  if (hasPublicSubnet) {
    for (const nat of graph.resources.filter((r) => r.serviceId === NAT_GATEWAY)) {
      const subs = topo.subnetsOf(nat);
      const inPublic = subs.some((s) => s.serviceId === SUBNET_PUBLIC);
      if (inPublic) continue;
      const target = publicSubnetForNat(graph, topo, nat);
      const scoped = !!target.subnet && !!topo.vpcOf(nat);
      const assumption = scoped
        ? ""
        : ` No VPC could be resolved for this NAT Gateway, so the first available public Subnet is assumed.`;
      out.push({
        id: `move-nat-to-public-subnet:${nat.id}`,
        kind: "move-nat-to-public-subnet",
        resourceId: nat.id,
        title: `Move "${nat.name}" to a public subnet`,
        detail: `NAT Gateway "${nat.name}" is not placed in a public Subnet. Apply to repoint its placement to an available public Subnet.${assumption}`,
      });
    }
  }

  // Deterministic ordering: by kind (declaration order), then resourceId, then id.
  const kindOrder: Record<FixKind, number> = {
    "close-open-sg": 0,
    "add-igw-default-route": 1,
    "enable-storage-encryption": 2,
    "move-nat-to-public-subnet": 3,
  };
  out.sort((a, b) => {
    if (a.kind !== b.kind) return kindOrder[a.kind] - kindOrder[b.kind];
    if (a.resourceId !== b.resourceId) return a.resourceId < b.resourceId ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return out;
}

// ---- application ------------------------------------------------------------

/** Deep-clone the mutable graph slices so a fix never touches the input. */
function cloneGraph(graph: InfrastructureGraph): InfrastructureGraph {
  return {
    ...graph,
    resources: graph.resources.map((r) => ({
      ...r,
      config: { ...r.config },
      ...(r.tags ? { tags: { ...r.tags } } : {}),
    })),
    relationships: graph.relationships.map((e) => ({ ...e })),
  };
}

/**
 * Apply the fix identified by `fixId` and return a NEW graph. The input is
 * never mutated. An unknown or no-longer-detectable `fixId` is a safe no-op:
 * the input graph is returned unchanged (callers that diff for "did anything
 * happen?" can compare by identity — a no-op returns the same reference).
 */
export function applyFix(graph: InfrastructureGraph, fixId: string): InfrastructureGraph {
  const fix = detectFixes(graph).find((f) => f.id === fixId);
  if (!fix) return graph;

  const next = cloneGraph(graph);
  const topo = buildTopo(next);

  switch (fix.kind) {
    case "close-open-sg": {
      const sg = next.resources.find((r) => r.id === fix.resourceId);
      const ingress = sg ? cfgStr(sg, "ingress") : undefined;
      if (sg && ingress) sg.config["ingress"] = tightenIngress(ingress);
      return next;
    }

    case "enable-storage-encryption": {
      const r = next.resources.find((x) => x.id === fix.resourceId);
      const key = r ? ENCRYPTION_KEYS[r.serviceId] : undefined;
      if (r && key) r.config[key] = true;
      return next;
    }

    case "add-igw-default-route": {
      const rt = next.resources.find((r) => r.id === fix.resourceId);
      // Scope the IGW to the route table's VPC; fall back to the first IGW
      // globally only when the VPC can't be resolved (matches detection).
      const igw =
        (rt ? igwForRouteTable(next, topo, rt) : undefined) ??
        next.resources.find((r) => r.serviceId === INTERNET_GATEWAY);
      if (rt && igw) {
        next.relationships.push({
          id: `autofix-route-${rt.id}-${igw.id}`,
          from: rt.id,
          to: igw.id,
          kind: "routes_to",
          destinationCidr: "0.0.0.0/0",
          label: "0.0.0.0/0",
          source: "manual",
        });
      }
      return next;
    }

    case "move-nat-to-public-subnet": {
      const nat = next.resources.find((r) => r.id === fix.resourceId);
      // Scope the target public subnet to the NAT's VPC; fall back to the first
      // public subnet globally only when the VPC can't be resolved (matches
      // detection).
      const publicSubnet =
        (nat ? publicSubnetForNat(next, topo, nat).subnet : undefined) ??
        next.resources.find((r) => r.serviceId === SUBNET_PUBLIC);
      if (!nat || !publicSubnet) return next;
      // Repoint placement: drop any existing subnet attachment/containment edges
      // (either direction) and any subnet parentId, then attach to the public
      // subnet via parentId (the importer/MCP placement convention).
      const subnetIds = new Set(
        next.resources
          .filter((r) => r.serviceId === SUBNET_PUBLIC || r.serviceId === SUBNET_PRIVATE)
          .map((r) => r.id),
      );
      next.relationships = next.relationships.filter((e) => {
        const isPlacement = e.kind === "contains" || e.kind === "attached_to";
        if (!isPlacement) return true;
        const touchesNatAndSubnet =
          (e.from === nat.id && subnetIds.has(e.to)) || (e.to === nat.id && subnetIds.has(e.from));
        return !touchesNatAndSubnet;
      });
      nat.parentId = publicSubnet.id;
      return next;
    }

    default: {
      // Exhaustiveness guard: a new FixKind without a case is a compile error.
      const _never: never = fix.kind;
      void _never;
      return next;
    }
  }
}
