/**
 * Strata — Diagram-as-Code DSL
 * ------------------------------------
 * A human-readable, round-trippable serialization of an `InfrastructureGraph`.
 *
 * The on-disk/clipboard form is YAML (via the existing `js-yaml` dependency),
 * chosen so a graph can be hand-edited, diffed in version control, or generated
 * by an agent and then re-imported losslessly. This engine is pure and
 * framework-free: no DOM, no network, no credentials.
 *
 *   graphToDsl(graph) -> string      // stable, deterministic YAML document
 *   dslToGraph(text)  -> { graph, errors[] }
 *
 * Round-trip contract: `dslToGraph(graphToDsl(g)).graph` deep-equals `g` for the
 * modeled fields (name, accounts, resources, relationships, viewport,
 * schemaVersion). Parsing NEVER throws — malformed YAML and structural problems
 * (unknown serviceIds, unknown relationship kinds, dangling refs from
 * `validateGraph`) are collected into `errors[]` so the caller can surface an
 * honest report and still inspect whatever parsed.
 *
 * Key ordering in the emitted document is stable (insertion order, sorted maps)
 * so two equivalent graphs diff cleanly.
 */
import { dump, load } from "js-yaml";
import {
  emptyGraph,
  isRelationshipKind,
  SCHEMA_VERSION,
  validateGraph,
  type Account,
  type InfrastructureGraph,
  type Relationship,
  type ResourceInstance,
  type Viewport,
} from "./model";
import { getService } from "./registry";
import type { CloudProvider } from "./types";

/** Result of parsing a DSL document: the best-effort graph plus any problems. */
export interface DslParseResult {
  graph: InfrastructureGraph;
  errors: string[];
}

// ----- DSL document shape (the YAML mirror of the graph) --------------------

/** An account as it appears in the DSL document. */
interface DslAccount {
  id: string;
  accountId: string;
  name: string;
  provider?: CloudProvider;
  environment?: string;
  color?: string;
}

/** A resource as it appears in the DSL document (flattened, readable keys). */
interface DslResource {
  id: string;
  service: string;
  name: string;
  account?: string;
  region?: string;
  parent?: string;
  arn?: string;
  source: ResourceInstance["source"];
  config?: Record<string, unknown>;
  tags?: Record<string, string>;
}

/** A relationship as it appears in the DSL document. */
interface DslRelationship {
  id: string;
  from: string;
  to: string;
  kind: string;
  label?: string;
  destinationCidr?: string;
  source?: ResourceInstance["source"];
}

/** The top-level DSL document. */
interface DslDocument {
  name: string;
  schemaVersion: number;
  description?: string;
  viewport?: Viewport;
  accounts: DslAccount[];
  resources: DslResource[];
  relationships: DslRelationship[];
}

// ----- Serialization (graph -> DSL) -----------------------------------------

/** Drop `undefined`-valued keys so the emitted YAML stays terse and stable. */
function compact<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    if (value !== undefined) out[key] = value;
  }
  return out as T;
}

function accountToDsl(a: Account): DslAccount {
  return compact({
    id: a.id,
    accountId: a.accountId,
    name: a.name,
    provider: a.provider,
    environment: a.environment,
    color: a.color,
  });
}

function resourceToDsl(r: ResourceInstance): DslResource {
  const config = r.config && Object.keys(r.config).length > 0 ? r.config : undefined;
  const tags = r.tags && Object.keys(r.tags).length > 0 ? r.tags : undefined;
  return compact({
    id: r.id,
    service: r.serviceId,
    name: r.name,
    account: r.accountId,
    region: r.region,
    parent: r.parentId,
    arn: r.arn,
    source: r.source,
    config,
    tags,
  });
}

function relationshipToDsl(e: Relationship): DslRelationship {
  return compact({
    id: e.id,
    from: e.from,
    to: e.to,
    kind: e.kind,
    label: e.label,
    destinationCidr: e.destinationCidr,
    source: e.source,
  });
}

/**
 * Emit a stable, human-readable YAML document for `graph`. Object keys follow a
 * fixed order (top-level then per-entry) and `js-yaml` is asked to sort map
 * keys, so equivalent graphs serialize identically for clean diffs.
 */
export function graphToDsl(graph: InfrastructureGraph): string {
  const doc: DslDocument = compact({
    name: graph.name,
    schemaVersion: graph.schemaVersion ?? SCHEMA_VERSION,
    description: graph.description,
    viewport: graph.viewport,
    accounts: graph.accounts.map(accountToDsl),
    resources: graph.resources.map(resourceToDsl),
    relationships: graph.relationships.map(relationshipToDsl),
  });
  return dump(doc, {
    sortKeys: true,
    noRefs: true,
    lineWidth: -1,
    indent: 2,
  });
}

// ----- Parsing (DSL -> graph) -----------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Read a `Record<string,string>` (tags) — drops non-string values. */
function asStringRecord(value: unknown): Record<string, string> | undefined {
  if (!isObject(value)) return undefined;
  const out: Record<string, string> = {};
  for (const key of Object.keys(value)) {
    const v = value[key];
    if (typeof v === "string") out[key] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function asConfig(value: unknown): Record<string, unknown> {
  return isObject(value) ? { ...value } : {};
}

function parseProvider(value: unknown): CloudProvider | undefined {
  return value === "aws" || value === "gcp" || value === "azure" ? value : undefined;
}

function parseSource(value: unknown): ResourceInstance["source"] {
  return value === "imported" || value === "mcp" ? value : "manual";
}

function parseViewport(value: unknown): Viewport | undefined {
  if (!isObject(value)) return undefined;
  const { x, y, scale } = value;
  if (typeof x === "number" && typeof y === "number" && typeof scale === "number") {
    return { x, y, scale };
  }
  return undefined;
}

function parseAccount(value: unknown, index: number, errors: string[]): Account | null {
  if (!isObject(value)) {
    errors.push(`Account entry #${index} is not an object`);
    return null;
  }
  const id = asString(value.id);
  const accountId = asString(value.accountId);
  const name = asString(value.name);
  if (id === undefined || accountId === undefined || name === undefined) {
    errors.push(`Account entry #${index} is missing id, accountId, or name`);
    return null;
  }
  return compact({
    id,
    accountId,
    name,
    provider: parseProvider(value.provider),
    environment: asString(value.environment),
    color: asString(value.color),
  });
}

function parseResource(value: unknown, index: number, errors: string[]): ResourceInstance | null {
  if (!isObject(value)) {
    errors.push(`Resource entry #${index} is not an object`);
    return null;
  }
  const id = asString(value.id);
  const serviceId = asString(value.service);
  const name = asString(value.name);
  if (id === undefined || serviceId === undefined || name === undefined) {
    errors.push(`Resource entry #${index} is missing id, service, or name`);
    return null;
  }
  if (!getService(serviceId)) {
    errors.push(`Resource ${id} references unknown service ${serviceId}`);
  }
  return compact({
    id,
    serviceId,
    name,
    accountId: asString(value.account),
    region: asString(value.region),
    parentId: asString(value.parent),
    arn: asString(value.arn),
    source: parseSource(value.source),
    config: asConfig(value.config),
    tags: asStringRecord(value.tags),
  });
}

function parseRelationship(value: unknown, index: number, errors: string[]): Relationship | null {
  if (!isObject(value)) {
    errors.push(`Relationship entry #${index} is not an object`);
    return null;
  }
  const id = asString(value.id);
  const from = asString(value.from);
  const to = asString(value.to);
  const kind = value.kind;
  if (id === undefined || from === undefined || to === undefined) {
    errors.push(`Relationship entry #${index} is missing id, from, or to`);
    return null;
  }
  if (!isRelationshipKind(kind)) {
    errors.push(`Relationship ${id} has unknown kind ${String(kind)}`);
  }
  return compact({
    id,
    from,
    to,
    // Keep the (possibly invalid) value so validateGraph can also report it and
    // so a round-trip preserves what was written; the error above is the signal.
    kind: isRelationshipKind(kind) ? kind : (kind as Relationship["kind"]),
    label: asString(value.label),
    destinationCidr: asString(value.destinationCidr),
    source: value.source === undefined ? undefined : parseSource(value.source),
  });
}

/**
 * Parse a DSL document into an `InfrastructureGraph`, collecting every problem
 * into `errors[]` instead of throwing. Malformed YAML yields a single parse
 * error and an empty graph; structural problems (missing fields, unknown
 * services/kinds, dangling refs) are surfaced via per-entry checks plus a final
 * `validateGraph` pass.
 */
export function dslToGraph(text: string): DslParseResult {
  const errors: string[] = [];
  const graph = emptyGraph();
  // emptyGraph() seeds an id-less, default-viewport graph; the DSL drives the
  // modeled fields below.
  graph.id = "";
  graph.accounts = [];
  graph.resources = [];
  graph.relationships = [];

  let parsed: unknown;
  try {
    parsed = load(text);
  } catch (err) {
    errors.push(`YAML parse error: ${err instanceof Error ? err.message : String(err)}`);
    return { graph, errors };
  }

  if (parsed === undefined || parsed === null) {
    errors.push("DSL document is empty");
    return { graph, errors };
  }
  if (!isObject(parsed)) {
    errors.push("DSL document is not a mapping/object");
    return { graph, errors };
  }

  const name = asString(parsed.name);
  if (name === undefined) {
    errors.push("DSL document is missing a name");
  } else {
    graph.name = name;
  }

  graph.schemaVersion =
    typeof parsed.schemaVersion === "number" ? parsed.schemaVersion : SCHEMA_VERSION;

  const description = asString(parsed.description);
  if (description !== undefined) graph.description = description;

  const viewport = parseViewport(parsed.viewport);
  if (viewport !== undefined) graph.viewport = viewport;
  else delete graph.viewport;

  if (parsed.accounts !== undefined) {
    if (Array.isArray(parsed.accounts)) {
      parsed.accounts.forEach((a, i) => {
        const account = parseAccount(a, i, errors);
        if (account) graph.accounts.push(account);
      });
    } else {
      errors.push("accounts is not a list");
    }
  }

  if (parsed.resources !== undefined) {
    if (Array.isArray(parsed.resources)) {
      parsed.resources.forEach((r, i) => {
        const resource = parseResource(r, i, errors);
        if (resource) graph.resources.push(resource);
      });
    } else {
      errors.push("resources is not a list");
    }
  }

  if (parsed.relationships !== undefined) {
    if (Array.isArray(parsed.relationships)) {
      parsed.relationships.forEach((e, i) => {
        const rel = parseRelationship(e, i, errors);
        if (rel) graph.relationships.push(rel);
      });
    } else {
      errors.push("relationships is not a list");
    }
  }

  // Final structural pass (duplicate ids, dangling parent/edge refs, …). These
  // are additive to the per-entry checks above; de-dupe so the same unknown
  // service isn't reported twice.
  for (const structural of validateGraph(graph)) {
    if (!errors.includes(structural)) errors.push(structural);
  }

  return { graph, errors };
}
