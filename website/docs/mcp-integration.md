---
sidebar_position: 6
title: MCP Integration
---

# MCP Integration Readiness

The system is structured to ingest **live AWS state** rather than only
hand-drawn diagrams. The integration module is `src/aws/mcp.ts` — it defines the
`DiscoveredResource` shape, `mapDiscoveredToGraph()`, and `unmappedTypes()`. A
discovery transport (the AWS MCP server / Cloud Control API) feeds it; wiring
that transport to a server Route Handler is the remaining step.

The module is intentionally a **pure, dependency-free transform**: it takes a
flat list of `DiscoveredResource` objects and maps them onto the registry-backed
graph the canvas already knows how to render.

## `DiscoveredResource`

A single resource as surfaced by an MCP server / Cloud Control API, after light
normalisation by the caller. `resourceType` (the CloudFormation type) is the
only strictly-required field for mapping.

```ts
export interface DiscoveredResource {
  arn?: string;
  /** CloudFormation type, e.g. "AWS::EC2::Instance". The registry join key. */
  resourceType: string;
  logicalId?: string;
  name?: string;
  region?: string;
  accountId?: string;
  /** ARN of the logical containment parent (VPC for a subnet, etc.). */
  parentArn?: string;
  /** Raw CloudFormation/Cloud-Control properties for this resource. */
  properties?: Record<string, unknown>;
  /** Outgoing edges to other discovered resources, keyed by target ARN. */
  relationships?: { targetArn: string; kind?: string }[];
}
```

## The join key: `cfnType` / Cloud Control type

The CloudFormation resource type on each `ServiceDefinition` (`cfnType`, e.g.
`AWS::EC2::VPC`, indexed in `CFN_INDEX` via `getServiceByCfnType()`) is the
**join key** between discovered AWS resources and the registry. The AWS MCP
server / Cloud Control API enumerate resources by their CloudFormation/Cloud
Control type, so a discovered resource maps deterministically onto a
`ServiceDefinition` by that type. Cloud Control also returns the same
`properties` shape CloudFormation uses, which lines up with the service's
`configFields`.

## `mapDiscoveredToGraph`

The importer turns a list of discovered resources into an
`InfrastructureGraph`. It runs in three passes:

1. **Resolve & index.** For each discovered resource, resolve its type via
   `getServiceByCfnType(type)`. Unknown types are skipped/flagged (and are
   candidates for new catalog entries). Mappable resources get a stable id
   (their ARN, or a generated UUID) and an `arn → id` index is built.
2. **Build `ResourceInstance`s.** `serviceId` from the matched definition, `arn`
   and `region`/`accountId` from discovery, `config` filtered to the keys the
   service's `configFields` actually model, `parentId` resolved from
   `parentArn`, and `source: "mcp"` so the UI marks it as discovered
   (read-only-by-default trust). A simple grid auto-layout assigns positions so
   the graph renders without a layout engine.
3. **Emit typed `Relationship`s** from each resource's `relationships`, resolving
   target ARNs to graph ids and defaulting `kind` to `"connects_to"` when missing
   or invalid. Edges whose target is outside the discovered set are dropped.

The result must pass `validateGraph()` before persist.
`unmappedTypes(resources)` reports the distinct CFN types with no registry
entry — surfacing registry gaps to operators/developers.

## Credential boundary (non-negotiable)

- **Read-only roles only.** Discovery uses read/describe/list permissions; the
  app never needs mutate permissions on the target account.
- **Scoped, short-lived sessions.** Assume a role per import with the narrowest
  policy and a short session TTL; scope by account + region.
- **NEVER persist credentials.** Credentials live only in process memory for the
  duration of an import. They are never written to `.data/`, never stored in an
  `InfrastructureGraph`, and never logged. Only the _resulting graph_ (ARNs,
  config, relationships) is persisted. `src/aws/mcp.ts` enforces this by
  construction: it only ever receives already-fetched resource descriptions —
  no access keys, session tokens, or secrets pass through it.
