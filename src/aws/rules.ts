/**
 * Architecture validation + rule suggestions.
 * ------------------------------------------
 * Re-expresses the network/architecture checks against the new domain model
 * (ResourceInstance.serviceId + Relationship.kind) instead of hardcoded UI
 * node-type strings. All service ids come from the registry.
 */
import type { InfrastructureGraph, ResourceInstance, Relationship } from "./model";
import { childrenOf } from "./model";
import type { RelationshipKind } from "./types";

export interface ValidationResult {
  level: "error" | "warn" | "ok";
  message: string;
  /** Resource the finding is about, when known — lets the UI badge that node. */
  resourceId?: string;
}

export interface RuleSuggestion {
  scope: string;
  type: string;
  rules: Record<string, unknown>[];
}

const SUBNET_IDS: ReadonlySet<string> = new Set(["subnet-public", "subnet-private"]);

function isSubnet(r: ResourceInstance): boolean {
  return SUBNET_IDS.has(r.serviceId);
}
function isPublicSubnet(r: ResourceInstance): boolean {
  return r.serviceId === "subnet-public";
}

/** A non-null, non-undefined type guard for use in `.filter(...)` chains. */
function isDefined<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

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
function parseCidr(cidr: string): { net: number; broadcast: number } | null {
  const [base, maskStr, extra] = cidr.split("/");
  if (extra !== undefined || maskStr === undefined) return null;
  if (!/^\d{1,2}$/.test(maskStr)) return null;
  const mask = Number(maskStr);
  if (mask < 0 || mask > 32) return null;
  const ip = ipv4ToInt(base);
  if (ip === null) return null;
  // A /0 mask shifts by 32 which is UB for `<<`; handle it explicitly.
  const hostBits = 32 - mask;
  const maskBits = hostBits === 32 ? 0 : (~0 << hostBits) >>> 0;
  const net = (ip & maskBits) >>> 0;
  const broadcast = (net | (hostBits === 32 ? 0xffffffff : (1 << hostBits) - 1)) >>> 0;
  return { net, broadcast };
}

/**
 * CIDR containment test (does `parent` contain `child`?).
 *
 * Returns `false` when either CIDR is malformed, so an invalid spec surfaces as
 * a validation finding rather than being silently treated as "contained".
 */
function cidrContains(parent: string, child: string): boolean {
  const p = parseCidr(parent);
  const c = parseCidr(child);
  if (!p || !c) return false;
  return c.net >= p.net && c.broadcast <= p.broadcast;
}

/**
 * A `routes_to` edge is a *default* route when its destination is the
 * all-addresses CIDR — or unspecified, which we treat as a default route for
 * back-compat with manually-drawn edges that omit `destinationCidr`. A
 * prefix-specific route (e.g. 10.1.0.0/16) does not by itself provide general
 * internet egress, so it must NOT satisfy the IGW/NAT default-route checks.
 */
function isDefaultRoute(e: Relationship): boolean {
  const d = e.destinationCidr;
  return d === undefined || d === "" || d === "0.0.0.0/0" || d === "::/0";
}

export function validateArchitecture(graph: InfrastructureGraph): ValidationResult[] {
  const out: ValidationResult[] = [];
  const resources = graph.resources;
  const rels = graph.relationships;

  const get = (id: string) => resources.find((r) => r.id === id);
  const ofService = (id: string) => resources.filter((r) => r.serviceId === id);
  const incoming = (id: string, kind?: RelationshipKind) =>
    rels.filter((e) => e.to === id && (!kind || e.kind === kind));
  const outgoing = (id: string, kind?: RelationshipKind) =>
    rels.filter((e) => e.from === id && (!kind || e.kind === kind));
  const cfgStr = (r: ResourceInstance, key: string): string | undefined => {
    const v = r.config[key];
    return typeof v === "string" && v ? v : undefined;
  };

  /**
   * Resolve the parent that "contains" `child`, treating containment as
   * expressed by EITHER:
   *   - an explicit `parentId` (how MCP/imported graphs model containment), or
   *   - a `contains`/`attached_to` edge in either direction.
   * `match` decides which candidate parents qualify (e.g. "is a VPC").
   *
   * Edge directions covered: child→parent and parent→child for both
   * `contains` and `attached_to`, so e.g. `vpc --contains--> subnet` and
   * `subnet --attached_to--> vpc` both resolve.
   */
  const containerOf = (
    child: ResourceInstance,
    match: (parent: ResourceInstance) => boolean,
  ): ResourceInstance | undefined => {
    // parentId-based containment (imported / MCP graphs).
    if (child.parentId) {
      const p = get(child.parentId);
      if (p && match(p)) return p;
    }
    // edge-based containment, either direction, contains or attached_to.
    const kinds: RelationshipKind[] = ["contains", "attached_to"];
    for (const kind of kinds) {
      const viaIncoming = incoming(child.id, kind)
        .map((e) => get(e.from))
        .find((n) => !!n && match(n));
      if (viaIncoming) return viaIncoming;
      const viaOutgoing = outgoing(child.id, kind)
        .map((e) => get(e.to))
        .find((n) => !!n && match(n));
      if (viaOutgoing) return viaOutgoing;
    }
    return undefined;
  };

  /**
   * All subnets a resource is placed in, treating placement as EITHER a
   * `contains`/`attached_to` edge (either direction) OR a `parentId` that
   * points at a subnet (with the subnet's own parentId chain not followed —
   * direct parent only, matching how importers stamp placement).
   */
  const subnetsOf = (r: ResourceInstance): ResourceInstance[] => {
    const found = new Map<string, ResourceInstance>();
    if (r.parentId) {
      const p = get(r.parentId);
      if (p && isSubnet(p)) found.set(p.id, p);
    }
    // A subnet contains the resource: subnet --contains--> r (incoming contains),
    // or the resource is attached to a subnet in either direction.
    const collect = (list: (ResourceInstance | undefined)[]) => {
      for (const n of list) if (n && isSubnet(n)) found.set(n.id, n);
    };
    collect(incoming(r.id, "contains").map((e) => get(e.from)));
    collect(outgoing(r.id, "contains").map((e) => get(e.to)));
    collect(incoming(r.id, "attached_to").map((e) => get(e.from)));
    collect(outgoing(r.id, "attached_to").map((e) => get(e.to)));
    // children stamped with parentId === r.id (rare, but symmetric).
    for (const c of childrenOf(graph, r.id)) if (isSubnet(c)) found.set(c.id, c);
    return [...found.values()];
  };

  /**
   * The Route Table associated with a subnet, resolved direction-agnostically:
   * either direction of an `attached_to` edge, or a `parentId` link. Mirrors how
   * `containerOf`/`subnetsOf` tolerate importer/MCP edge-direction differences
   * so the IGW/NAT egress checks below don't false-positive on graphs that model
   * the RT↔subnet attachment the other way round.
   */
  const isRouteTable = (n: ResourceInstance | undefined): n is ResourceInstance =>
    !!n && n.serviceId === "route-table";
  const routeTableFor = (sn: ResourceInstance): ResourceInstance | undefined =>
    incoming(sn.id, "attached_to")
      .map((e) => get(e.from))
      .find(isRouteTable) ??
    outgoing(sn.id, "attached_to")
      .map((e) => get(e.to))
      .find(isRouteTable) ??
    (sn.parentId && isRouteTable(get(sn.parentId)) ? get(sn.parentId) : undefined) ??
    childrenOf(graph, sn.id).find(isRouteTable);

  // Subnets must be contained by a VPC (parentId, contains or attached_to),
  // CIDR inside VPC.
  resources.filter(isSubnet).forEach((sn) => {
    const parentVpc = containerOf(sn, (n) => n.serviceId === "vpc");
    if (!parentVpc) {
      out.push({
        level: "error",
        message: `Subnet "${sn.name}" should be contained by a VPC.`,
        resourceId: sn.id,
      });
    } else {
      const sc = cfgStr(sn, "cidr");
      const pc = cfgStr(parentVpc, "cidr");
      if (sc && pc && !cidrContains(pc, sc)) {
        out.push({
          level: "error",
          message: `Subnet ${sc} is not inside VPC ${pc}.`,
          resourceId: sn.id,
        });
      }
    }
  });

  // Route tables attached to at least one subnet. Accept the attachment edge in
  // either direction, mirroring the direction-agnostic helpers above.
  ofService("route-table").forEach((rt) => {
    const subs = [
      ...incoming(rt.id, "attached_to").map((e) => get(e.from)),
      ...outgoing(rt.id, "attached_to").map((e) => get(e.to)),
    ]
      .filter(isDefined)
      .filter(isSubnet);
    if (subs.length === 0) {
      out.push({
        level: "warn",
        message: `Route Table "${rt.name}" is not attached to any Subnet.`,
        resourceId: rt.id,
      });
    }
  });

  // NACLs attached to a subnet. Accept the attachment edge in either direction.
  ofService("nacl").forEach((nacl) => {
    const subs = [
      ...incoming(nacl.id, "attached_to").map((e) => get(e.from)),
      ...outgoing(nacl.id, "attached_to").map((e) => get(e.to)),
    ]
      .filter(isDefined)
      .filter(isSubnet);
    if (subs.length === 0) {
      out.push({
        level: "warn",
        message: `NACL "${nacl.name}" is not attached to any Subnet.`,
        resourceId: nacl.id,
      });
    }
  });

  // Internet Gateway must be attached to a VPC. Accept the edge in either direction.
  ofService("internet-gateway").forEach((igw) => {
    const vpc = [
      ...incoming(igw.id, "attached_to").map((e) => get(e.from)),
      ...outgoing(igw.id, "attached_to").map((e) => get(e.to)),
    ].find((n) => n && n.serviceId === "vpc");
    if (!vpc) {
      out.push({
        level: "error",
        message: `Internet Gateway "${igw.name}" must be attached to a VPC.`,
        resourceId: igw.id,
      });
    }
  });

  // Public subnet should have a Route Table that routes_to an IGW.
  resources.filter(isPublicSubnet).forEach((sn) => {
    const rt = routeTableFor(sn);
    const hasIgw =
      !!rt &&
      rels.some(
        (e) =>
          e.from === rt.id &&
          e.kind === "routes_to" &&
          get(e.to)?.serviceId === "internet-gateway" &&
          isDefaultRoute(e),
      );
    if (!rt || !hasIgw) {
      out.push({
        level: "error",
        message: `Public Subnet "${sn.name}" should have a Route Table that routes to an Internet Gateway.`,
        resourceId: sn.id,
      });
    }
  });

  // NAT Gateway must sit in a public subnet.
  ofService("nat-gateway").forEach((nat) => {
    const subs = subnetsOf(nat);
    const subnet = subs.find(isPublicSubnet) ?? subs[0];
    if (!subnet || !isPublicSubnet(subnet)) {
      out.push({
        level: "error",
        message: `NAT Gateway "${nat.name}" should be placed in a public Subnet.`,
        resourceId: nat.id,
      });
    }
  });

  // Private subnet egress via Route Table → NAT.
  resources
    .filter((r) => r.serviceId === "subnet-private")
    .forEach((sn) => {
      const rt = routeTableFor(sn);
      const hasNat =
        !!rt &&
        rels.some(
          (e) =>
            e.from === rt.id &&
            e.kind === "routes_to" &&
            get(e.to)?.serviceId === "nat-gateway" &&
            isDefaultRoute(e),
        );
      if (!rt || !hasNat) {
        out.push({
          level: "warn",
          message: `Private Subnet "${sn.name}" usually needs a Route Table that routes to a NAT Gateway for egress.`,
          resourceId: sn.id,
        });
      }
    });

  // Load balancer placement + targets.
  ofService("elastic-load-balancer").forEach((alb) => {
    const subs = subnetsOf(alb);
    const publicSubs = subs.filter(isPublicSubnet);
    if (publicSubs.length === 0) {
      out.push({
        level: "warn",
        message: `Load Balancer "${alb.name}" is not placed in any public Subnet.`,
        resourceId: alb.id,
      });
    } else {
      // AWS requires an ALB to have subnets in at least two Availability Zones.
      // Distinct AZs come from the subnet `az` config; subnets with no az are
      // each treated as a distinct (unknown) zone so we don't under-count, but
      // a single subnet can never satisfy the multi-AZ requirement.
      const azs = new Set<string>();
      publicSubs.forEach((s, i) => azs.add(cfgStr(s, "az") ?? `__unknown_${i}__`));
      if (azs.size < 2) {
        out.push({
          level: "error",
          message: `Load Balancer "${alb.name}" must have public Subnets in at least 2 Availability Zones.`,
          resourceId: alb.id,
        });
      }
    }
    const tg = outgoing(alb.id, "targets")
      .map((e) => get(e.to))
      .find((n) => n && n.serviceId === "target-group");
    if (!tg) {
      out.push({
        level: "warn",
        message: `Load Balancer "${alb.name}" should target a Target Group.`,
        resourceId: alb.id,
      });
    }
  });

  // Target group should target a valid target type. ALBs forward to instance
  // targets (EC2), IP targets (ENIs / arbitrary IPs), Lambda functions, or
  // another load balancer (ALB-as-target chaining for NLB → ALB setups).
  const VALID_TG_TARGETS: ReadonlySet<string> = new Set([
    "ecs-service",
    "ec2-instance",
    "lambda",
    "elastic-load-balancer",
  ]);
  ofService("target-group").forEach((tg) => {
    const target = outgoing(tg.id, "targets")
      .map((e) => get(e.to))
      .find((n) => n && VALID_TG_TARGETS.has(n.serviceId));
    if (!target) {
      out.push({
        level: "warn",
        message: `Target Group "${tg.name}" should target a compute target (ECS Service, EC2 instance, Lambda, or an ALB).`,
        resourceId: tg.id,
      });
    }
  });

  // ECS service: subnet placement + security group.
  ofService("ecs-service").forEach((svc) => {
    const subs = subnetsOf(svc);
    if (subs.length === 0) {
      out.push({
        level: "error",
        message: `ECS Service "${svc.name}" must be attached to Subnet(s).`,
        resourceId: svc.id,
      });
    }
    const sg =
      incoming(svc.id, "attached_to")
        .map((e) => get(e.from))
        .find((n) => n && n.serviceId === "security-group") ??
      outgoing(svc.id, "attached_to")
        .map((e) => get(e.to))
        .find((n) => n && n.serviceId === "security-group");
    if (!sg) {
      out.push({
        level: "error",
        message: `ECS Service "${svc.name}" should be attached to a Security Group.`,
        resourceId: svc.id,
      });
    }
  });

  // RDS: private subnet placement + security group.
  ofService("rds").forEach((rds) => {
    const subs = subnetsOf(rds);
    if (subs.length === 0) {
      out.push({
        level: "warn",
        message: `RDS "${rds.name}" should be attached to private Subnet(s).`,
        resourceId: rds.id,
      });
    }
    subs.forEach((s) => {
      if (isPublicSubnet(s)) {
        out.push({
          level: "error",
          message: `RDS "${rds.name}" should not be in public Subnet "${s.name}".`,
          resourceId: rds.id,
        });
      }
    });
    const sg =
      incoming(rds.id, "attached_to")
        .map((e) => get(e.from))
        .find((n) => n && n.serviceId === "security-group") ??
      outgoing(rds.id, "attached_to")
        .map((e) => get(e.to))
        .find((n) => n && n.serviceId === "security-group");
    if (!sg) {
      out.push({
        level: "warn",
        message: `RDS "${rds.name}" should be attached to a Security Group.`,
        resourceId: rds.id,
      });
    }
    if (rds.config["publiclyAccessible"] === true) {
      out.push({
        level: "error",
        message: `RDS "${rds.name}" must not be publicly accessible.`,
        resourceId: rds.id,
      });
    }
  });

  // S3 buckets: Block Public Access must stay on. Unset defaults to on (`true`),
  // so only an explicit `false` is a finding.
  ofService("s3-bucket").forEach((b) => {
    if (b.config["blockPublicAccess"] === false) {
      out.push({
        level: "warn",
        message: `S3 bucket "${b.name}" has Block Public Access disabled; the bucket may be publicly accessible.`,
        resourceId: b.id,
      });
    }
  });

  // Encryption at rest: services that store data unencrypted (explicit `false`)
  // get a warning. RDS/DocumentDB/Neptune share the `storageEncrypted` key — the
  // RDS finding is implemented here too, so it isn't duplicated above. Aurora and
  // S3 are intentionally excluded.
  const ENCRYPTION_AT_REST: Record<string, string> = {
    "ebs-volume": "encrypted",
    efs: "encrypted",
    rds: "storageEncrypted",
    documentdb: "storageEncrypted",
    neptune: "storageEncrypted",
  };
  for (const [serviceId, key] of Object.entries(ENCRYPTION_AT_REST)) {
    ofService(serviceId).forEach((r) => {
      if (r.config[key] === false) {
        out.push({
          level: "warn",
          message: `${r.name} stores data at rest unencrypted; enable encryption.`,
          resourceId: r.id,
        });
      }
    });
  }

  // Security Groups: flag sensitive ports exposed to the world. The `ingress`
  // free-text is one rule per line, each `<proto> <port> <cidr>`. Ports 80/443
  // are intentionally not sensitive (the tool itself suggests 0.0.0.0/0 there).
  const SENSITIVE_PORTS: ReadonlySet<number> = new Set([22, 3389, 3306, 5432, 1433, 6379]);
  const portTokenIsSensitive = (token: string): boolean => {
    if (/^\d+$/.test(token)) return SENSITIVE_PORTS.has(Number(token));
    if (/^\d+-\d+$/.test(token)) {
      const [lo, hi] = token.split("-").map(Number);
      for (const p of SENSITIVE_PORTS) if (p >= lo && p <= hi) return true;
      return false;
    }
    if (token.includes(",")) {
      return token.split(",").some((t) => /^\d+$/.test(t) && SENSITIVE_PORTS.has(Number(t)));
    }
    return false;
  };
  ofService("security-group").forEach((sg) => {
    const ingress = cfgStr(sg, "ingress");
    if (!ingress) return;
    for (const line of ingress.split("\n")) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 3) continue; // skip malformed lines
      const [, port, cidr] = parts;
      if ((cidr === "0.0.0.0/0" || cidr === "::/0") && portTokenIsSensitive(port)) {
        out.push({
          level: "warn",
          message: `Security Group "${sg.name}" exposes sensitive port ${port} to the world (${cidr}).`,
          resourceId: sg.id,
        });
      }
    }
  });

  // GCP Cloud Storage: uniform bucket-level access should stay enabled.
  ofService("gcp-cloud-storage").forEach((b) => {
    if (b.config["uniformBucketLevelAccess"] === false) {
      out.push({
        level: "warn",
        message: `Cloud Storage bucket "${b.name}" has uniform bucket-level access disabled; per-object ACLs allow public exposure.`,
        resourceId: b.id,
      });
    }
  });

  // GCP Firewall rule: an ingress ALLOW from 0.0.0.0/0 to a sensitive port. The
  // `allowed` text references tokens like `tcp:22`; direction/action default to
  // INGRESS/ALLOW when unset.
  ofService("gcp-firewall-rule").forEach((fw) => {
    const direction = (cfgStr(fw, "direction") ?? "INGRESS").toUpperCase();
    const action = (cfgStr(fw, "action") ?? "ALLOW").toUpperCase();
    const sourceRanges = cfgStr(fw, "sourceRanges") ?? "";
    const allowed = cfgStr(fw, "allowed") ?? "";
    if (direction !== "INGRESS" || action !== "ALLOW" || !sourceRanges.includes("0.0.0.0/0")) {
      return;
    }
    for (const token of allowed.split(/[\s,]+/)) {
      const portStr = token.split(":")[1];
      if (portStr && portTokenIsSensitive(portStr)) {
        out.push({
          level: "warn",
          message: `Firewall rule "${fw.name}" exposes sensitive port ${portStr} to the world (0.0.0.0/0).`,
          resourceId: fw.id,
        });
      }
    }
  });

  // Azure Storage Account: public blob access should stay disabled.
  ofService("azure-storage-account").forEach((sa) => {
    if (sa.config["allowPublicAccess"] === true) {
      out.push({
        level: "warn",
        message: `Storage Account "${sa.name}" has public blob access enabled.`,
        resourceId: sa.id,
      });
    }
  });

  // Azure Redis: the non-SSL port should stay disabled.
  ofService("azure-redis").forEach((redis) => {
    if (redis.config["enableNonSslPort"] === true) {
      out.push({
        level: "warn",
        message: `Redis "${redis.name}" has the non-SSL port enabled.`,
        resourceId: redis.id,
      });
    }
  });

  return out;
}

export function suggestRules(graph: InfrastructureGraph): RuleSuggestion[] {
  const out: RuleSuggestion[] = [];
  const resources = graph.resources;
  const rels = graph.relationships;
  const get = (id: string) => resources.find((r) => r.id === id);
  const incoming = (id: string, kind?: RelationshipKind) =>
    rels.filter((e) => e.to === id && (!kind || e.kind === kind));
  const outgoing = (id: string, kind?: RelationshipKind) =>
    rels.filter((e) => e.from === id && (!kind || e.kind === kind));

  resources
    .filter((n) => n.serviceId === "elastic-load-balancer")
    .forEach((alb) => {
      out.push({
        scope: alb.name,
        type: "Security Group",
        rules: [
          {
            dir: "ingress",
            proto: "tcp",
            port: "80,443",
            src: "0.0.0.0/0",
            comment: "Public HTTP/HTTPS to ALB",
          },
        ],
      });
      const tg = outgoing(alb.id, "targets")
        .map((e) => get(e.to))
        .find((n) => n && n.serviceId === "target-group");
      // Only EC2/ECS targets get an inbound SG rule; Lambda/ELB targets are
      // reached without a security group, so they intentionally get none.
      const svc = tg
        ? outgoing(tg.id, "targets")
            .map((e) => get(e.to))
            .find((n) => n && (n.serviceId === "ecs-service" || n.serviceId === "ec2-instance"))
        : undefined;
      if (svc && tg) {
        const svcSg = incoming(svc.id, "attached_to")
          .map((e) => get(e.from))
          .find((n) => n && n.serviceId === "security-group");
        if (svcSg) {
          // The listener port lives on the target group; fall back to the
          // service's own port config, then 80.
          const port = String(tg.config["port"] ?? svc.config["port"] ?? 80);
          out.push({
            scope: svcSg.name,
            type: "Security Group",
            rules: [
              {
                dir: "ingress",
                proto: "tcp",
                port,
                src: `sg:${alb.name}`,
                comment: "ALB to Service",
              },
            ],
          });
        }
      }
    });

  // RDS ingress from the app tier: open the DB's engine port to the upstream
  // app's Security Group (ALB → target group → service → SG, or any
  // ecs-service/ec2-instance SG as a fallback).
  const sgOf = (id: string): ResourceInstance | undefined =>
    incoming(id, "attached_to")
      .map((e) => get(e.from))
      .find((n) => n && n.serviceId === "security-group") ??
    outgoing(id, "attached_to")
      .map((e) => get(e.to))
      .find((n) => n && n.serviceId === "security-group");
  const RDS_ENGINE_PORTS: Record<string, number> = {
    postgres: 5432,
    mysql: 3306,
    mariadb: 3306,
    "oracle-se2": 1521,
    "sqlserver-se": 1433,
  };
  resources
    .filter((n) => n.serviceId === "rds")
    .forEach((rds) => {
      const dbSg = sgOf(rds.id);
      if (!dbSg) return;
      // Walk ALB → target group → service → SG for an app tier source.
      let appSg: ResourceInstance | undefined;
      for (const alb of resources.filter((n) => n.serviceId === "elastic-load-balancer")) {
        const tg = outgoing(alb.id, "targets")
          .map((e) => get(e.to))
          .find((n) => n && n.serviceId === "target-group");
        const svc = tg
          ? outgoing(tg.id, "targets")
              .map((e) => get(e.to))
              .find((n) => n && (n.serviceId === "ecs-service" || n.serviceId === "ec2-instance"))
          : undefined;
        if (svc) appSg = sgOf(svc.id);
        if (appSg) break;
      }
      // Fall back to any compute resource's SG in the graph.
      if (!appSg) {
        for (const svc of resources.filter(
          (n) => n.serviceId === "ecs-service" || n.serviceId === "ec2-instance",
        )) {
          appSg = sgOf(svc.id);
          if (appSg) break;
        }
      }
      if (!appSg || appSg.id === dbSg.id) return;
      const engine = typeof rds.config["engine"] === "string" ? rds.config["engine"] : "";
      const port = RDS_ENGINE_PORTS[engine] ?? 5432;
      out.push({
        scope: dbSg.name,
        type: "Security Group",
        rules: [
          { dir: "ingress", proto: "tcp", port, src: `sg:${appSg.name}`, comment: "App to DB" },
        ],
      });
    });

  // Per-subnet egress route. Skip when a `routes_to` edge to the correct gateway
  // already exists (mirrors validateArchitecture's resolution).
  const routesTo = (subnetId: string, gatewayServiceId: string): boolean => {
    const rt =
      incoming(subnetId, "attached_to")
        .map((e) => get(e.from))
        .find((n) => n && n.serviceId === "route-table") ??
      outgoing(subnetId, "attached_to")
        .map((e) => get(e.to))
        .find((n) => n && n.serviceId === "route-table");
    if (!rt) return false;
    return outgoing(rt.id, "routes_to").some(
      (e) => get(e.to)?.serviceId === gatewayServiceId && isDefaultRoute(e),
    );
  };
  resources
    .filter((n) => n.serviceId === "subnet-private")
    .forEach((sn) => {
      if (routesTo(sn.id, "nat-gateway")) return;
      out.push({
        scope: sn.name,
        type: "Route Table",
        rules: [
          { route: "0.0.0.0/0", target: "NAT Gateway", comment: "Egress for private subnet" },
        ],
      });
    });

  resources
    .filter((n) => n.serviceId === "subnet-public")
    .forEach((sn) => {
      if (routesTo(sn.id, "internet-gateway")) return;
      out.push({
        scope: sn.name,
        type: "Route Table",
        rules: [
          { route: "0.0.0.0/0", target: "Internet Gateway", comment: "Public internet access" },
        ],
      });
    });

  resources
    .filter((n) => n.serviceId === "nacl")
    .forEach((nacl) => {
      out.push({
        scope: nacl.name,
        type: "NACL",
        rules: [
          {
            num: 100,
            dir: "ingress",
            proto: "tcp",
            port: "1024-65535",
            src: "0.0.0.0/0",
            allow: true,
            comment: "Ephemeral return traffic",
          },
          {
            num: 110,
            dir: "egress",
            proto: "tcp",
            port: "0-65535",
            dst: "0.0.0.0/0",
            allow: true,
            comment: "All egress",
          },
        ],
      });
    });

  return out;
}
