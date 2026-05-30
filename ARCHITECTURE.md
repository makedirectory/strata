# AWS Flow Builder — Architecture

> A registry-driven canvas for modeling AWS infrastructure as a typed graph of
> resources and relationships, persisted through a swappable repository, and
> built to ingest live AWS state via MCP / Cloud Control.

---

## 1. Overview & Goals

AWS Flow Builder exists to make AWS infrastructure **legible**: to turn a sprawling
account (or many accounts) into a navigable, typed diagram that a human can read,
reason about, and edit.

Two design goals drive everything below:

1. **Model the broad AWS service network, not a handful of icons.** The service
   vocabulary lives in a single, extensible registry spanning 14 categories
   (networking, compute, containers, storage, database, integration, security,
   identity, monitoring, analytics, ai-ml, deployment, management, edge — see
   `src/aws/categories.ts`). Resources are connected with a rich, typed
   relationship vocabulary (`contains`, `routes_to`, `invokes`, `peers_with`, …)
   rather than anonymous lines.

2. **Everything visual and behavioural is _derived_ from data, never hardcoded.**
   The palette, node colours, icons, inspector forms, validation, and (future)
   MCP import all read from the registry (`src/aws/registry.ts`). Supporting a new
   AWS service is a one-entry data change with **no UI code change** (see §2).

The stack is intentionally boring and self-contained: a single Next.js app where
the API Route Handlers _are_ the server, a domain model decoupled from rendering,
and a file-backed store that requires zero infrastructure to run.

### Positioning (what this is, and is not)

AWS already ships [Workload Discovery on AWS](https://github.com/aws-solutions/workload-discovery-on-aws)
for **discovering and visualizing existing infrastructure** (Config-driven, Neptune +
OpenSearch backed, deployed into your account). AWS Flow Builder deliberately does
**not** compete on that axis. It is positioned as a **design-first, local-first,
MCP-native** tool:

- **Design & validate before you build** — sketch a target architecture and get
  best-practice validation and rule suggestions (`src/aws/rules.ts`), not just a
  read-only picture of what already exists.
- **Local-first, zero infrastructure** — runs from a single Next.js process with a
  file store; no multi-service stack to deploy.
- **MCP-native** — the registry (typed relationships, `cfnType` join keys, config
  schemas) is built as a substrate an LLM/agent can reason over. MCP discovery is
  used to **import a slice of reality to reconcile/annotate a design** (§6), not to
  be a discovery platform.
- **Portable diagram-as-code** — the `InfrastructureGraph` JSON is version-controllable
  and not locked in a proprietary datastore.

### Layer map

| Layer                     | Location                                                                                    | Responsibility                       |
| ------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------ |
| Service registry / schema | `src/aws/types.ts`, `src/aws/registry.ts`, `src/aws/categories.ts`, `src/aws/services/*.ts` | The canonical AWS vocabulary         |
| Domain model              | `src/aws/model.ts`, `src/aws/regions.ts`                                                    | Persisted environment representation |
| Visual / UI               | `src/components/*`, `src/hooks/*`                                                           | Palette, canvas, inspector           |
| Server / persistence      | `src/server/*`, `src/app/api/graphs/*`                                                      | Repository + Route Handlers          |
| Import readiness          | `src/aws/mcp.ts`                                                                            | MCP / Cloud Control ingestion        |

---

## 2. The Service Registry & Schema

### Schema (`src/aws/types.ts`)

The registry is built from a small set of structures:

- **`ServiceDefinition`** — the reusable definition of one AWS service. Key fields:
  - `id` — canonical kebab-case id, stable across versions (e.g. `"ec2-instance"`).
  - `name` / `fullName` / `abbreviation` — display strings.
  - `category` — one of the 14 `ServiceCategoryId`s; drives palette grouping and
    the default colour.
  - `icon` — currently an emoji token, swappable for the AWS icon set later.
  - `scope` — a `ServiceScope` (`global | region | az | vpc | subnet`) describing
    where the resource conceptually lives (see §3, placement scopes).
  - `isContainer` — `true` for services that visually contain others (VPC, Subnet).
  - `color` — optional per-service override; otherwise the category colour wins.
  - `configFields` — the dynamic inspector form schema (see `ConfigField`).
  - `commonConnections` — suggested outgoing edges for hints / auto-wiring.
  - `cfnType` — the CloudFormation type, which **doubles as the MCP / Cloud Control
    import discriminator** (see §6).
  - `arnPattern`, `keywords`, `docsUrl` — reference / search metadata.

- **`ConfigField`** — one configurable property: `key`, `label`, `type`
  (`string | number | boolean | select | multiselect | cidr | text | arn | tags`),
  plus `default`, `options`, `required`, `help`, `placeholder`, and `group`. The
  inspector renders a form purely from these — no per-service form code.

- **`RelationshipKind`** — the typed-edge vocabulary (16 kinds in `types.ts`).
  Each has presentation/validation metadata in `RELATIONSHIPS`
  (`src/aws/categories.ts`): a `label`, `description`, a `solid`/`dashed` style
  hint, and a `symmetric` flag (e.g. `peers_with`).

- **`CategoryDefinition`** — presentation metadata per category: `color` (hex,
  used for node accenting and the legend) and `icon`. Defined in
  `CATEGORIES` and ordered by `CATEGORY_ORDER` (`src/aws/categories.ts`).

### Registry aggregation (`src/aws/registry.ts`)

`registry.ts` imports every category catalog from `src/aws/services/*.ts`,
`flat()`-tens them into `SERVICES`, and builds two indexes:

- `SERVICE_INDEX` — `id → ServiceDefinition` for O(1) lookup.
- `CFN_INDEX` — `cfnType → ServiceDefinition`, the join table the MCP importer uses.
  `cfnType` is **not unique**: the registry intentionally models variants of one
  CloudFormation type as distinct services (e.g. public vs private
  `AWS::EC2::Subnet`, or `AWS::Lambda::Function` as `lambda` and `lambda-edge`).
  The index is **first-wins** — the first service for a `cfnType` becomes the
  canonical variant `getServiceByCfnType` returns; each subsequent collision is
  recorded in `CFN_TYPE_COLLISIONS` and surfaced as a **warning** by
  `validateRegistry()` (not an integrity error). MCP import maps to the canonical
  variant; a downstream refinement step can reclassify by inspecting properties.

Public accessors include `getService`, `requireService`, `getServiceByCfnType`,
`allServices`, `servicesByCategory`, `serviceColor` (per-service override → category
colour fallback), `serviceIcon`, `defaultConfig` (builds the initial config object
from `ConfigField.default`s), and `searchServices` (free-text over name / fullName /
description / id / keywords).

`validateRegistry()` is a dev-time guardrail returning `RegistryIssue[]` (each
`level: "error" | "warn"`): `error`s for duplicate ids and unknown categories, and
`warn`s for dangling `commonConnections` targets and shared-`cfnType` collisions.
**This should be wired into CI** (see §7).

### How to add a new service — one catalog entry, no UI changes

1. Open the catalog for the service's category, e.g.
   `src/aws/services/networking.ts`. Use that file as the canonical template:
   every entry is a `ServiceDefinition` and the file's **default export is the
   array**.
2. Append a new object. Minimal example (modeled on the VPC entry in
   `networking.ts`):

   ```ts
   {
     id: "global-accelerator",
     name: "Global Accelerator",
     fullName: "AWS Global Accelerator",
     category: "edge",
     description: "Improves availability and performance via the AWS global network.",
     icon: "🚀",
     scope: "global",
     cfnType: "AWS::GlobalAccelerator::Accelerator",
     keywords: ["accelerator", "anycast", "edge"],
     configFields: [
       { key: "ipAddressType", label: "IP Address Type", type: "select",
         default: "IPV4", options: [
           { value: "IPV4", label: "IPv4" },
           { value: "DUAL_STACK", label: "Dual Stack" },
         ] },
     ],
     commonConnections: [
       { to: "elastic-load-balancer", relationship: "targets" },
     ],
   }
   ```

3. That's it. The palette section, node colour/icon, inspector form, search, and
   import mapping all pick it up automatically because they read the registry.
   If you reference a new category, add it to both `CATEGORIES` and `CATEGORY_ORDER`
   in `src/aws/categories.ts`.
4. Run `validateRegistry()` to confirm there are no duplicate ids or dangling
   `commonConnections.to` targets.

---

## 3. The Domain Data Model

The persisted representation of an AWS environment lives in `src/aws/model.ts`. It
is **deliberately decoupled from rendering**: a resource references a
`ServiceDefinition` by id and stores config keyed by that service's `ConfigField`
keys. This is exactly what the server stores and what the MCP importer produces.

### Entities

- **`Account`** — an AWS account in scope: `accountId` (12-digit), `name`,
  optional `environment` (`"prod" | "staging" | …`) and `color`.
- **`RegionRef`** — `{ code, name }`. The common set lives in `src/aws/regions.ts`
  (`REGIONS`, `regionName(code)`); extend freely.
- **`ResourceInstance`** — a concrete instance of a service:
  - `serviceId` references `ServiceDefinition.id`.
  - **Placement / scoping:** `accountId`, `region`, and `parentId`.
  - `config: Record<string, unknown>` keyed by the service's `ConfigField` keys.
  - `tags`, `arn` (real ARN when known), and `source`
    (`"manual" | "imported" | "mcp"` — drives trust/edit affordances).
  - `position?: CanvasPosition` (`x, y, w, h`) — presentation kept separate from data.
- **`Relationship`** — a typed, directional (or symmetric) edge:
  `{ id, from, to, kind, label?, source? }` where `from`/`to` are
  `ResourceInstance.id`s and `kind` is a `RelationshipKind`.
- **`InfrastructureGraph`** — the top-level persisted entity: `id`, `name`,
  `accounts[]`, `resources[]`, `relationships[]`, optional `viewport`,
  `createdAt`/`updatedAt` (stamped by the repository, never by scripts), and
  `schemaVersion` (`SCHEMA_VERSION = 1`, for forward migration).

### Containment via `parentId`

Logical containment is modeled as a single field, `ResourceInstance.parentId`:
a VPC contains subnets, a subnet contains EC2 instances, etc. This is a tree
reference, distinct from the relationship graph. Helpers:

- `childrenOf(graph, parentId)` — direct children.
- `resourcesByAccount(graph, accountId)`.
- `relationshipsOf(graph, resourceId)`.

> **Note:** containment is _modeled_ today but nested visual rendering (drawing
> children inside their parent container) is phase-2. See §7.

### Placement scopes

`ServiceDefinition.scope` (`global | region | az | vpc | subnet`) describes where a
resource conceptually belongs and is the basis for placement validation and future
layout: IAM is `global`, an S3 bucket is `region`-scoped, a subnet is `az`-scoped,
an EC2 instance must sit inside a subnet, and so on.

### Validation & summaries

- `validateGraph(graph)` returns structural errors: duplicate resource ids,
  `parentId`s pointing at missing resources, and relationships referencing missing
  `from`/`to`. The API enforces this on every write (see §5). **Wire into CI** (§7).
- `summarize(graph) → GraphSummary` produces the lightweight shape list endpoints
  return (avoids shipping full graphs).
- `emptyGraph(name)` produces a minimal valid graph; `id`/timestamps are assigned
  on persist.

---

## 4. Visual Mapping Architecture

The UI is **registry-driven**: nothing about a service's appearance or its form is
hardcoded in components.

- **Palette** (`src/components/Palette.tsx`) renders sections from `CATEGORY_ORDER`
  and the services in each category, using `serviceIcon()` / `serviceColor()` and
  `searchServices()` for filtering.
- **Colours & icons** come from `serviceColor(id)` (per-service override → category
  colour fallback) and `serviceIcon(id)`. The category colour palette is the single
  source for the legend and node accenting.
- **Inspector** (`src/components/Inspector.tsx`) renders a dynamic form straight from
  the selected service's `configFields` — each `ConfigField.type` maps to an input
  widget. Adding a field to a catalog entry adds it to the form.
- **Canvas** (`src/components/Canvas.tsx` + `src/hooks/*`) operates on the domain
  model: resources become nodes (positioned by `CanvasPosition`), and
  `Relationship`s become **typed edges** styled by `RELATIONSHIPS[kind].style`
  (solid/dashed) and labelled by `RELATIONSHIPS[kind].label`.
- **Interaction & state** is split across hooks: `useFlowStore` holds
  resources/relationships/viewport/selection and exposes actions (`addResource`,
  `connect`, `updateResource`, `updateResourcePosition`, `removeSelection`,
  `duplicateSelection`, `replaceAll`, …); `useHistory` provides undo/redo;
  `useCanvasInteraction` handles pointer/drag/pan; `useCanvasRenderer` paints the
  world.

> **Renderer note (important for scale):** `useCanvasRenderer` is an _imperative
> full-redraw_ renderer — each `draw()` sets `world.innerHTML = ""` and recreates
> every node DOM element from scratch. This is fine for hand-built diagrams but
> will not scale to MCP-sized graphs. See §7.

---

## 5. Persistence & the Server Side

### The Route Handlers _are_ the server

There is no separate backend service. The Next.js App Router Route Handlers under
`src/app/api/graphs/` are the entire server tier:

- `src/app/api/graphs/route.ts`
  - `GET /api/graphs` → `repo.list()` → `{ graphs: GraphSummary[] }`.
  - `POST /api/graphs` → merges the body over `emptyGraph(name)`, runs
    `validateGraph()` (422 on failure), then `repo.create()` → `201`.
- `src/app/api/graphs/[id]/route.ts`
  - `GET /api/graphs/:id` → full graph or `404`.
  - `PUT /api/graphs/:id` → first a runtime shape check via `hasGraphCollections()`
    (`src/server/graphSchema.ts`), which requires `name` plus the
    `accounts`/`resources`/`relationships` arrays and returns `422` if any are
    missing — this guards a trust boundary so undefined collections can't be
    persisted as silent data loss. It then fills optional defaults over
    `emptyGraph(body.name)`, runs `validateGraph()` (`422` on errors), and
    `repo.update()` (`404` if absent).
  - `DELETE /api/graphs/:id` → `repo.remove()`.

Both files set `export const dynamic = "force-dynamic"` so reads/writes always hit
the store. They never talk to a concrete store — only to a `Repository`.

### The `Repository` interface (`src/server/repository.ts`)

The application talks to this interface, never to a concrete store:

```ts
export interface Repository {
  list(): Promise<GraphSummary[]>;
  get(id: string): Promise<InfrastructureGraph | null>;
  create(graph: InfrastructureGraph): Promise<InfrastructureGraph>; // assigns id + timestamps
  update(id: string, graph: InfrastructureGraph): Promise<InfrastructureGraph | null>; // null if absent
  remove(id: string): Promise<boolean>;
}
```

### Default: file-backed (`src/server/fileRepository.ts`)

`FileRepository` stores each graph as JSON under `.data/graphs/<id>.json`
(override the directory with `AWS_FLOW_DATA_DIR`). It runs with **zero external
infrastructure** — ideal for local dev and demos. It assigns `randomUUID()` ids and
`createdAt`/`updatedAt` timestamps on write, stamps `SCHEMA_VERSION`, sorts list
results by `updatedAt`, and guards `fileFor()` against path traversal.

### Selecting a backend (`src/server/index.ts`)

`getRepository()` lazily constructs and memoizes the active store, chosen by the
`AWS_FLOW_REPOSITORY` env var (default `"file"`). The `switch` already has commented
slots for `"postgres"` and `"dynamodb"`:

```ts
const kind = process.env.AWS_FLOW_REPOSITORY ?? "file";
switch (kind) {
  case "file":
  default:
    instance = new FileRepository();
    break;
  // case "postgres": instance = new PostgresRepository(); break;
  // case "dynamodb": instance = new DynamoRepository(); break;
}
```

### Swapping to Postgres/RDS or DynamoDB

A new backend implements the five-method `Repository` interface and is registered in
the `getRepository()` switch — **no caller changes**. Sketch:

```ts
// src/server/postgresRepository.ts
export class PostgresRepository implements Repository {
  async list() {
    /* SELECT id,name,description,jsonb_array_length(resources),updated_at … */
  }
  async get(id) {
    /* SELECT doc FROM graphs WHERE id = $1 */
  }
  async create(g) {
    /* INSERT … RETURNING; set id=gen_random_uuid(), created_at/updated_at=now() */
  }
  async update(id, g) {
    /* UPDATE … WHERE id=$1 RETURNING; null if 0 rows */
  }
  async remove(id) {
    /* DELETE … WHERE id=$1; return rowCount>0 */
  }
}
```

Store the full `InfrastructureGraph` as a JSONB column (Postgres) or a single item
(DynamoDB, partition key = `id`); `list()` projects to `GraphSummary`. Preserve the
contract the file store establishes: server-assigned ids, server-stamped timestamps,
`SCHEMA_VERSION` on every write, and `null`/`false` on missing records.

---

## 6. MCP Integration Readiness

The system is structured to ingest **live AWS state** rather than only hand-drawn
diagrams. The integration module is `src/aws/mcp.ts` — it defines the
`DiscoveredResource` shape, `mapDiscoveredToGraph()`, and `unmappedTypes()`. A
discovery transport (the AWS MCP server / Cloud Control API) feeds it; wiring that
transport to a server Route Handler is the remaining step.

### The join key: `cfnType` / Cloud Control type

The CloudFormation resource type on each `ServiceDefinition` (`cfnType`, e.g.
`AWS::EC2::VPC`, indexed in `CFN_INDEX` via `getServiceByCfnType()`) is the **join
key** between discovered AWS resources and the registry. The AWS MCP server / Cloud
Control API enumerate resources by their CloudFormation/Cloud Control type, so a
discovered resource maps deterministically onto a `ServiceDefinition` by that type.

### `mapDiscoveredToGraph`

The importer's job is to turn a list of discovered resources into an
`InfrastructureGraph`:

1. For each discovered resource, resolve its type via `getServiceByCfnType(type)`.
   Unknown types are skipped/flagged (and are candidates for new catalog entries).
2. Build a `ResourceInstance`: `serviceId` from the matched definition, `arn` and
   `region`/`accountId` from discovery, `config` mapped from Cloud Control
   properties into the service's `ConfigField` keys, `tags` carried through, and
   `source: "mcp"` so the UI can mark it as discovered (read-only-by-default trust).
3. Derive `parentId` from containment hints (e.g. a subnet's `VpcId`) and emit typed
   `Relationship`s from discovered references (security-group attachments, route
   targets, etc.), using the same `RelationshipKind` vocabulary.
4. Return a valid `InfrastructureGraph` (it must pass `validateGraph()` before persist).

### Credential boundary (non-negotiable)

- **Read-only roles only.** Discovery uses read/describe/list permissions; the app
  never needs mutate permissions on the target account.
- **Scoped, short-lived sessions.** Assume a role per import with the narrowest
  policy and a short session TTL; scope by account + region.
- **NEVER persist credentials.** Credentials live only in process memory for the
  duration of an import. They are never written to `.data/`, never stored in an
  `InfrastructureGraph`, and never logged. Only the _resulting graph_ (ARNs, config,
  relationships) is persisted.

---

## 7. Gaps, Risks & Recommended Next Steps

Candid assessment of what is incomplete or will break at scale.

1. **Nested rendering is phase-2.** Containment is fully modeled (`parentId`,
   `isContainer`, `childrenOf`) but the canvas does not yet render children _inside_
   their parent containers. Until it does, VPC→subnet→instance hierarchy is only
   logical, not visual. _Next:_ implement container layout (resources nested within
   their parent's bounds; collapse/expand).

2. **The imperative full-redraw renderer will not scale.**
   `useCanvasRenderer.draw()` wipes the DOM (`world.innerHTML = ""`) and rebuilds
   every node each frame. For hand-built diagrams (tens of nodes) this is fine; for
   MCP-sized graphs (1000s of nodes) it will be unusable. _Next:_ move to a
   reconciliation model (diff-and-patch or a retained renderer / canvas/WebGL),
   add **viewport culling** (only render visible nodes), and add **automatic layout**
   (dagre or ELK) so imported graphs are legible without manual placement.

3. **IAM / Security Groups / KMS should be overlays, not peer nodes.** Drawing every
   IAM role, security group, and KMS key as a first-class node produces "spaghetti"
   that buries the architecture. _Next:_ render these as **toggleable overlays**
   (badges/highlights on the resources they apply to) rather than nodes and edges in
   the main graph. The relationship vocabulary already distinguishes them
   (`assumes`, `grants`, `allows`, `attached_to`) so the data supports it.

4. **Id strategy: UUID vs ARN coexistence.** Manually-created resources get
   server-assigned UUIDs (`randomUUID()`); imported resources have real ARNs.
   `ResourceInstance` carries both (`id` + optional `arn`), but there is no defined
   policy for de-duplication, re-import/merge, or stable identity across imports.
   _Next:_ define ARN as the stable external key, keep UUID as the internal id, and
   build a merge/upsert path so re-importing an account updates existing resources
   instead of duplicating them.

5. **Deep-clone-per-action history is memory-costly at scale.** `useHistory.commit()`
   `structuredClone`s the state on every committed action (falling back to
   `JSON.parse(JSON.stringify(state))` only where `structuredClone` is unavailable)
   and retains up to 100 snapshots. Each snapshot is a full copy of all nodes/edges —
   fine for small graphs, expensive for large/imported ones. _Next:_ switch to a
   command/patch-based (diff) history or structural sharing.

6. **Tests exist but are not yet wired into CI.** There is a Vitest suite — 176
   tests across 9 files covering the registry, domain model, rules, MCP importer,
   server (graph schema + file repository), the graphs API route, and the Palette
   component — run via `npm test` (`vitest run`) or `npm run test:coverage`.
   `validateRegistry()` and `validateGraph()` are exercised by those tests but at
   runtime still only run at module load / on API writes. _Next:_ **wire the suite
   into CI** (and run `validateRegistry()` / `validateGraph()` over fixtures there)
   so duplicate ids, dangling `commonConnections`, and structural breakage fail the
   build.

7. **Auth and multi-tenancy are absent on the server.** The Route Handlers and
   `Repository` have no concept of a user, tenant, or authorization — any caller can
   list/read/write/delete any graph. This is acceptable for local/demo use only.
   _Next:_ add authentication, per-tenant scoping on every `Repository` method, and
   authorization checks in the Route Handlers before any multi-user deployment.
