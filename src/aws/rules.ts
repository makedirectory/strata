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

  // Subnets must be contained by a VPC (parentId, contains or attached_to),
  // CIDR inside VPC.
  resources.filter(isSubnet).forEach((sn) => {
    const parentVpc = containerOf(sn, (n) => n.serviceId === "vpc");
    if (!parentVpc) {
      out.push({ level: "error", message: `Subnet "${sn.name}" should be contained by a VPC.` });
    } else {
      const sc = cfgStr(sn, "cidr");
      const pc = cfgStr(parentVpc, "cidr");
      if (sc && pc && !cidrContains(pc, sc)) {
        out.push({ level: "error", message: `Subnet ${sc} is not inside VPC ${pc}.` });
      }
    }
  });

  // Route tables attached to at least one subnet.
  ofService("route-table").forEach((rt) => {
    const subs = outgoing(rt.id, "attached_to")
      .map((e) => get(e.to))
      .filter(isDefined)
      .filter(isSubnet);
    if (subs.length === 0) {
      out.push({
        level: "warn",
        message: `Route Table "${rt.name}" is not attached to any Subnet.`,
      });
    }
  });

  // NACLs attached to a subnet.
  ofService("nacl").forEach((nacl) => {
    const subs = outgoing(nacl.id, "attached_to")
      .map((e) => get(e.to))
      .filter(isDefined)
      .filter(isSubnet);
    if (subs.length === 0) {
      out.push({ level: "warn", message: `NACL "${nacl.name}" is not attached to any Subnet.` });
    }
  });

  // Internet Gateway must be attached to a VPC.
  ofService("internet-gateway").forEach((igw) => {
    const vpc = outgoing(igw.id, "attached_to")
      .map((e) => get(e.to))
      .find((n) => n && n.serviceId === "vpc");
    if (!vpc) {
      out.push({
        level: "error",
        message: `Internet Gateway "${igw.name}" must be attached to a VPC.`,
      });
    }
  });

  // Public subnet should have a Route Table that routes_to an IGW.
  resources.filter(isPublicSubnet).forEach((sn) => {
    const rt = incoming(sn.id, "attached_to")
      .map((e) => get(e.from))
      .find((n) => n && n.serviceId === "route-table");
    const hasIgw =
      !!rt &&
      rels.some(
        (e) =>
          e.from === rt.id && e.kind === "routes_to" && get(e.to)?.serviceId === "internet-gateway",
      );
    if (!rt || !hasIgw) {
      out.push({
        level: "error",
        message: `Public Subnet "${sn.name}" should have a Route Table that routes to an Internet Gateway.`,
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
      });
    }
  });

  // Private subnet egress via Route Table → NAT.
  resources
    .filter((r) => r.serviceId === "subnet-private")
    .forEach((sn) => {
      const rt = incoming(sn.id, "attached_to")
        .map((e) => get(e.from))
        .find((n) => n && n.serviceId === "route-table");
      const hasNat =
        !!rt &&
        rels.some(
          (e) =>
            e.from === rt.id && e.kind === "routes_to" && get(e.to)?.serviceId === "nat-gateway",
        );
      if (!rt || !hasNat) {
        out.push({
          level: "warn",
          message: `Private Subnet "${sn.name}" usually needs a Route Table that routes to a NAT Gateway for egress.`,
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
      });
    }
    subs.forEach((s) => {
      if (isPublicSubnet(s)) {
        out.push({
          level: "warn",
          message: `RDS "${rds.name}" should not be in public Subnet "${s.name}".`,
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
      });
    }
  });

  return out;
}

function guessServicePort(svc: ResourceInstance): string {
  const port = svc.config["port"];
  if (typeof port === "number") return String(port);
  if (typeof port === "string" && port) return port;
  return "80";
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
      const svc = tg
        ? outgoing(tg.id, "targets")
            .map((e) => get(e.to))
            .find((n) => n && (n.serviceId === "ecs-service" || n.serviceId === "ec2-instance"))
        : undefined;
      if (svc) {
        const svcSg = incoming(svc.id, "attached_to")
          .map((e) => get(e.from))
          .find((n) => n && n.serviceId === "security-group");
        if (svcSg) {
          out.push({
            scope: svcSg.name,
            type: "Security Group",
            rules: [
              {
                dir: "ingress",
                proto: "tcp",
                port: guessServicePort(svc),
                src: `sg:${alb.name}`,
                comment: "ALB to Service",
              },
            ],
          });
        }
      }
    });

  resources
    .filter((n) => n.serviceId === "subnet-private")
    .forEach((sn) => {
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
