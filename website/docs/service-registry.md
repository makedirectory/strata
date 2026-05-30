---
sidebar_position: 2
title: Service Registry & Schema
---

# The Service Registry & Schema

The registry is the single source of truth for AWS service metadata. The UI,
validation engine, and MCP importer all read from it — nothing about a service
is hardcoded elsewhere.

## Schema (`src/aws/types.ts`)

The registry is built from a small set of structures.

### `ServiceDefinition`

The reusable definition of one AWS service. Key fields:

- `id` — canonical kebab-case id, stable across versions (e.g. `"ec2-instance"`).
- `name` / `fullName` / `abbreviation` — display strings.
- `category` — one of the 14 `ServiceCategoryId`s; drives palette grouping and
  the default colour.
- `icon` — currently an emoji token, swappable for the AWS icon set later.
- `scope` — a `ServiceScope` (`global | region | az | vpc | subnet`) describing
  where the resource conceptually lives (see
  [Data Model → scopes](./data-model.md#placement-scopes)).
- `isContainer` — `true` for services that visually contain others (VPC, Subnet).
- `color` — optional per-service override; otherwise the category colour wins.
- `configFields` — the dynamic inspector form schema (see `ConfigField`).
- `commonConnections` — suggested outgoing edges for hints / auto-wiring.
- `cfnType` — the CloudFormation type, which **doubles as the MCP / Cloud
  Control import discriminator** (see [MCP Integration](./mcp-integration.md)).
- `arnPattern`, `keywords`, `docsUrl` — reference / search metadata.

```ts
export interface ServiceDefinition {
  id: string;
  name: string;
  fullName: string;
  abbreviation?: string;
  category: ServiceCategoryId;
  description: string;
  icon: string;
  scope: ServiceScope;
  isContainer?: boolean;
  color?: string;
  configFields: ConfigField[];
  commonConnections: CommonConnection[];
  cfnType?: string;
  arnPattern?: string;
  keywords?: string[];
  docsUrl?: string;
}
```

### `ConfigField`

One configurable property: `key`, `label`, `type`
(`string | number | boolean | select | multiselect | cidr | text | arn | tags`),
plus `default`, `options`, `required`, `help`, `placeholder`, and `group`. The
inspector renders a form purely from these — no per-service form code.

### `RelationshipKind`

The typed-edge vocabulary (16 kinds in `types.ts`). Each has
presentation/validation metadata in `RELATIONSHIPS` (`src/aws/categories.ts`): a
`label`, `description`, a `solid`/`dashed` style hint, and a `symmetric` flag
(e.g. `peers_with`). The full list: `contains`, `attached_to`, `routes_to`,
`depends_on`, `allows`, `targets`, `reads_from`, `writes_to`, `invokes`,
`publishes_to`, `subscribes_to`, `assumes`, `grants`, `monitors`, `peers_with`,
`connects_to`.

### `CategoryDefinition`

Presentation metadata per category: `color` (hex, used for node accenting and
the legend) and `icon`. Defined in `CATEGORIES` and ordered by `CATEGORY_ORDER`
(`src/aws/categories.ts`).

## Registry aggregation (`src/aws/registry.ts`)

`registry.ts` imports every category catalog from `src/aws/services/*.ts`,
`flat()`-tens them into `SERVICES`, and builds two indexes:

- `SERVICE_INDEX` — `id → ServiceDefinition` for O(1) lookup.
- `CFN_INDEX` — `cfnType → ServiceDefinition`, the join table the MCP importer
  uses. `cfnType` is **not unique**: the registry intentionally models variants of
  one CloudFormation type as distinct services (e.g. public vs private
  `AWS::EC2::Subnet`). The index is **first-wins** — the first service for a
  `cfnType` is the canonical variant `getServiceByCfnType` returns; each subsequent
  collision is recorded in `CFN_TYPE_COLLISIONS` and surfaced as a **warning** by
  `validateRegistry()` rather than silently dropped or treated as an error.

Public accessors include `getService`, `requireService`,
`getServiceByCfnType`, `allServices`, `servicesByCategory`, `serviceColor`
(per-service override → category colour fallback), `serviceIcon`,
`defaultConfig` (builds the initial config object from `ConfigField.default`s),
and `searchServices` (free-text over name / fullName / description / id /
keywords).

`validateRegistry()` is a dev-time guardrail returning `RegistryIssue[]` (each
`level: "error" | "warn"`): `error`s for duplicate ids and unknown categories, and
`warn`s for dangling `commonConnections` targets and `cfnType` collisions. **This
should be wired into CI** (see
[Testing](./testing.md) and [Roadmap](./roadmap.md)).

## How to add a new service — one catalog entry, no UI changes

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
   If you reference a new category, add it to both `CATEGORIES` and
   `CATEGORY_ORDER` in `src/aws/categories.ts`.
4. Run `validateRegistry()` to confirm there are no duplicate ids, dangling
   `commonConnections.to` targets, or `cfnType` collisions.
