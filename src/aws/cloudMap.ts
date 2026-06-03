/**
 * Multi-cloud equivalence mapping — `mapToCloud`.
 * ------------------------------------------------
 * Rewrites an `InfrastructureGraph` so that every resource is expressed using
 * the target provider's services (aws → gcp, gcp → azure, …). The mapping is a
 * best-effort, registry-driven translation: there is no global concept-ontology
 * in the registry, so equivalence is keyed on two derived signals:
 *
 *   1. `category` — the authoritative cross-provider grouping every service
 *      already declares (networking, compute, storage, database, …).
 *   2. a derived **capability token** — a coarse intra-category role (e.g.
 *      `relational-db` vs `nosql-db`, `object-store` vs `block-store`, `vpc` vs
 *      `nat`). The registry has no `capability` field, so this engine derives
 *      one locally from the service id/name/keywords. The token is purely a
 *      ranking hint: a same-category candidate is always acceptable, a
 *      same-token candidate is *preferred*.
 *
 * Honest reporting: resources with no category-equivalent in the target
 * provider are NOT silently dropped — they are omitted from the rewritten
 * graph's `resources` and recorded in `unmapped[]` with a human reason.
 * Relationships that reference an unmapped (dropped) resource are likewise
 * dropped (they would be dangling refs) and noted. A resource already on the
 * target provider is kept verbatim. A resource whose category exists in the
 * target but has no capability-token match is also recorded in `unmapped[]`,
 * but is kept UNCHANGED in the output graph (never force-mapped onto an
 * arbitrary same-category service), so its relationships stay valid.
 *
 * Pure and framework-free: no DOM, no network, no credentials, no mutation of
 * the input graph (a fresh graph object is always returned). Candidate
 * selection is deterministic (stable sort by service id) so re-runs and tests
 * are reproducible. This engine composes the registry only and never modifies
 * it; the `provider` of a resource lives on its `ServiceDefinition`, so a
 * mapping is purely a `serviceId` swap (see the integrator note below).
 *
 * INTEGRATOR NOTE: if a per-resource `provider` field is ever added to
 * `ResourceInstance`, the rewrite here should also stamp that field. Today the
 * effective provider is derived from the (rewritten) serviceId via the
 * registry, so no model change is required.
 */
import type { CloudProvider, ServiceCategoryId, ServiceDefinition } from "./types";
import type { InfrastructureGraph, Relationship, ResourceInstance } from "./model";
import { allServices, getService, serviceProvider } from "./registry";

/** A resource that could not be translated to the target provider. */
export interface UnmappedResource {
  resourceId: string;
  serviceId: string;
  name: string;
  category: string;
  reason: string;
}

/** The outcome of a `mapToCloud` run: the rewritten graph + honest gaps. */
export interface CloudMapResult {
  graph: InfrastructureGraph;
  unmapped: UnmappedResource[];
}

/**
 * Coarse intra-category capability tokens. Two services share a token when they
 * fill the same architectural role even across providers (e.g. S3 / GCS / Azure
 * Blob are all `object-store`). The token is derived heuristically from a
 * service's id, name and keywords — the registry carries no such field.
 */
type Capability =
  | "object-store"
  | "block-store"
  | "file-store"
  | "relational-db"
  | "nosql-db"
  | "cache"
  | "warehouse"
  | "vm"
  | "serverless-fn"
  | "container-runtime"
  | "queue"
  | "topic"
  | "firewall"
  | "vpc"
  | "subnet"
  | "load-balancer"
  | "nat"
  | "gateway"
  | "dns"
  | "cdn"
  | "generic";

/** Ordered keyword rules: first matching rule wins. Lower-cased haystack match. */
const CAPABILITY_RULES: ReadonlyArray<{ token: Capability; needles: readonly string[] }> = [
  { token: "object-store", needles: ["object", "bucket", "blob", "s3", "gcs"] },
  { token: "block-store", needles: ["block", "ebs", "persistent disk", "managed disk", "volume"] },
  { token: "file-store", needles: ["file", "nfs", "efs", "filestore", "fsx"] },
  { token: "warehouse", needles: ["warehouse", "redshift", "bigquery", "synapse"] },
  // NoSQL is checked before relational so that wide-column/document stores
  // (Bigtable, DynamoDB, Firestore, Cosmos) aren't swept up by the broad "sql"
  // / "relational" needles below.
  {
    token: "nosql-db",
    needles: [
      "nosql",
      "dynamo",
      "document",
      "firestore",
      "cosmos",
      "wide-column",
      "bigtable",
      "mongo",
    ],
  },
  {
    token: "relational-db",
    needles: ["relational", "rdbms", "postgres", "mysql", "rds", "aurora", "spanner", "sql"],
  },
  {
    token: "cache",
    needles: ["cache", "redis", "memcached", "elasticache", "memorystore", "memorydb"],
  },
  { token: "serverless-fn", needles: ["lambda", "function", "cloud functions", "serverless"] },
  {
    token: "container-runtime",
    needles: ["container", "kubernetes", "eks", "gke", "aks", "fargate", "cloud run", "ecs"],
  },
  { token: "vm", needles: ["instance", "virtual machine", "compute engine", "ec2", "vm"] },
  { token: "queue", needles: ["queue", "sqs", "pub/sub queue"] },
  { token: "topic", needles: ["topic", "sns", "pub/sub", "pubsub", "event grid", "eventbridge"] },
  { token: "load-balancer", needles: ["load balancer", "load-balancer", "elb", "alb", "nlb"] },
  { token: "nat", needles: ["nat"] },
  // Firewall / security-group rules sit in the networking category in several
  // catalogs and their names mention "VPC"; match them before the VPC token so
  // a firewall isn't treated as a network container.
  {
    token: "firewall",
    needles: [
      "firewall",
      "security group",
      "security-group",
      "nacl",
      "network security group",
      "nsg",
    ],
  },
  { token: "subnet", needles: ["subnet"] },
  { token: "vpc", needles: ["virtual network", "vnet", "vpc"] },
  { token: "dns", needles: ["dns", "route53", "cloud dns"] },
  { token: "cdn", needles: ["cdn", "cloudfront", "content delivery"] },
  { token: "gateway", needles: ["gateway"] },
];

/** Derive a capability token from a service definition (deterministic). */
function capabilityOf(service: ServiceDefinition): Capability {
  const haystack = [service.id, service.name, service.fullName, ...(service.keywords ?? [])]
    .join(" ")
    .toLowerCase();
  for (const rule of CAPABILITY_RULES) {
    if (rule.needles.some((n) => haystack.includes(n))) return rule.token;
  }
  return "generic";
}

/** Why a candidate could not be picked, distinguishing the two failure modes. */
type NoCandidate = "no-category" | "no-capability-match";

/**
 * Pick the best target-provider service for a source service.
 *
 * Candidate pool = all target-provider services in the same category. A service
 * sharing the source's capability token is required: among the matches, the
 * lowest service id wins (stable, deterministic). When NO candidate shares the
 * source's capability token the choice is ambiguous — rather than force a wrong
 * mapping onto an arbitrary same-category service (e.g. a DNS service onto a
 * random networking service), we return a typed failure so the caller can leave
 * the resource UNCHANGED and report it as unmapped. Returns:
 *   - a `ServiceDefinition` on a confident capability-token match;
 *   - `"no-category"` when the target has no service in the source's category;
 *   - `"no-capability-match"` when the category exists but no token matches.
 */
function pickCandidate(
  source: ServiceDefinition,
  target: CloudProvider,
): ServiceDefinition | NoCandidate {
  const category: ServiceCategoryId = source.category;
  const pool = allServices(target)
    .filter((s) => s.category === category)
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id));
  if (pool.length === 0) return "no-category";
  const wanted = capabilityOf(source);
  const tokenMatch = pool.find((s) => capabilityOf(s) === wanted);
  return tokenMatch ?? "no-capability-match";
}

/** Shallow-clone a resource with a (possibly) new serviceId. */
function rewriteResource(resource: ResourceInstance, newServiceId: string): ResourceInstance {
  return {
    ...resource,
    serviceId: newServiceId,
    config: { ...resource.config },
    ...(resource.tags ? { tags: { ...resource.tags } } : {}),
  };
}

/**
 * Map every resource in `graph` to the `target` provider's equivalent service.
 *
 * - A resource already on `target` is kept verbatim (no-op for that resource —
 *   makes mapping idempotent when source and target match).
 * - A resource whose service is unknown to the registry, or whose category has
 *   no equivalent in `target`, is dropped from the rewritten graph and recorded
 *   in `unmapped[]` with a reason.
 * - A resource whose category exists in `target` but has no capability-token
 *   match is reported in `unmapped[]` yet kept UNCHANGED (original
 *   serviceId/provider preserved) — never force-rewritten onto an arbitrary
 *   same-category service. It survives, so its relationships stay valid.
 * - Relationships are retained only when both endpoints survive; otherwise they
 *   are dropped (avoiding dangling refs).
 *
 * Always returns a brand-new graph object; the input is never mutated.
 */
export function mapToCloud(graph: InfrastructureGraph, target: CloudProvider): CloudMapResult {
  const unmapped: UnmappedResource[] = [];
  const mappedResources: ResourceInstance[] = [];
  /** ids of resources that survived the mapping (used to prune relationships/parents). */
  const survived = new Set<string>();

  for (const resource of graph.resources) {
    const source = getService(resource.serviceId);
    if (!source) {
      unmapped.push({
        resourceId: resource.id,
        serviceId: resource.serviceId,
        name: resource.name,
        category: "unknown",
        reason: `Unknown service id "${resource.serviceId}" — not present in the registry.`,
      });
      continue;
    }

    if (serviceProvider(source) === target) {
      // Already on the target provider; keep as-is.
      mappedResources.push(rewriteResource(resource, resource.serviceId));
      survived.add(resource.id);
      continue;
    }

    const candidate = pickCandidate(source, target);
    if (candidate === "no-category") {
      unmapped.push({
        resourceId: resource.id,
        serviceId: resource.serviceId,
        name: resource.name,
        category: source.category,
        reason: `${target.toUpperCase()} has no service in category "${source.category}" to map ${source.name} onto.`,
      });
      continue;
    }
    if (candidate === "no-capability-match") {
      // No confident capability-token match in the target category. Rather than
      // force a wrong rewrite onto an arbitrary same-category service, leave the
      // resource UNCHANGED (original serviceId/provider preserved) and report it
      // as unmapped. It still "survives" so its relationships stay valid — this
      // keeps the output graph free of dangling refs.
      unmapped.push({
        resourceId: resource.id,
        serviceId: resource.serviceId,
        name: resource.name,
        category: source.category,
        reason: `${target.toUpperCase()} has no capability-equivalent for ${source.name} in category "${source.category}"; left unchanged.`,
      });
      mappedResources.push(rewriteResource(resource, resource.serviceId));
      survived.add(resource.id);
      continue;
    }

    mappedResources.push(rewriteResource(resource, candidate.id));
    survived.add(resource.id);
  }

  // A dropped resource can leave a child pointing at a missing parent. Clear the
  // parentId in that case rather than producing a dangling reference.
  const resources = mappedResources.map((r) =>
    r.parentId && !survived.has(r.parentId) ? { ...r, parentId: undefined } : r,
  );

  // Keep only relationships whose both endpoints survived the mapping.
  const relationships: Relationship[] = graph.relationships
    .filter((rel) => survived.has(rel.from) && survived.has(rel.to))
    .map((rel) => ({ ...rel }));

  // Deterministic ordering of the honest gap report.
  unmapped.sort((a, b) => a.resourceId.localeCompare(b.resourceId));

  const mappedGraph: InfrastructureGraph = {
    ...graph,
    accounts: graph.accounts.map((a) => ({ ...a })),
    resources,
    relationships,
    ...(graph.viewport ? { viewport: { ...graph.viewport } } : {}),
  };

  return { graph: mappedGraph, unmapped };
}
