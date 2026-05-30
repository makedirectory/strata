---
sidebar_position: 1
title: Overview
---

# AWS Flow Builder

> A registry-driven canvas for modeling AWS infrastructure as a typed graph of
> resources and relationships, persisted through a swappable repository, and
> built to ingest live AWS state via MCP / Cloud Control.

AWS Flow Builder exists to make AWS infrastructure **legible**: to turn a
sprawling account (or many accounts) into a navigable, typed diagram that a
human can read, reason about, and edit.

## Goals

Two design goals drive everything:

1. **Model the broad AWS service network, not a handful of icons.** The service
   vocabulary lives in a single, extensible registry spanning 14 categories
   (networking, compute, containers, storage, database, integration, security,
   identity, monitoring, analytics, ai-ml, deployment, management, edge — see
   `src/aws/categories.ts`). Resources are connected with a rich, typed
   relationship vocabulary (`contains`, `routes_to`, `invokes`, `peers_with`, …)
   rather than anonymous lines.

2. **Everything visual and behavioural is _derived_ from data, never
   hardcoded.** The palette, node colours, icons, inspector forms, validation,
   and (future) MCP import all read from the registry (`src/aws/registry.ts`).
   Supporting a new AWS service is a one-entry data change with **no UI code
   change** (see [Service Registry](./service-registry.md)).

The stack is intentionally boring and self-contained: a single Next.js app where
the API Route Handlers _are_ the server, a domain model decoupled from
rendering, and a file-backed store that requires zero infrastructure to run.

## Positioning — what this is, and is not

AWS already ships
[Workload Discovery on AWS](https://github.com/aws-solutions/workload-discovery-on-aws)
for **discovering and visualizing existing infrastructure** (Config-driven,
Neptune + OpenSearch backed, deployed into your account). AWS Flow Builder
deliberately does **not** compete on that axis. It is positioned as a
**design-first, local-first, MCP-native** tool:

- **Design & validate before you build** — sketch a target architecture and get
  best-practice validation and rule suggestions (`src/aws/rules.ts`), not just a
  read-only picture of what already exists.
- **Local-first, zero infrastructure** — runs from a single Next.js process with
  a file store; no multi-service stack to deploy.
- **MCP-native** — the registry (typed relationships, `cfnType` join keys,
  config schemas) is built as a substrate an LLM/agent can reason over. MCP
  discovery is used to **import a slice of reality to reconcile/annotate a
  design** (see [MCP Integration](./mcp-integration.md)), not to be a discovery
  platform.
- **Portable diagram-as-code** — the `InfrastructureGraph` JSON is
  version-controllable and not locked in a proprietary datastore.

## Layer map

| Layer                     | Location                                                                                    | Responsibility                       |
| ------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------ |
| Service registry / schema | `src/aws/types.ts`, `src/aws/registry.ts`, `src/aws/categories.ts`, `src/aws/services/*.ts` | The canonical AWS vocabulary         |
| Domain model              | `src/aws/model.ts`, `src/aws/regions.ts`                                                    | Persisted environment representation |
| Visual / UI               | `src/components/*`, `src/hooks/*`                                                           | Palette, canvas, inspector           |
| Server / persistence      | `src/server/*`, `src/app/api/graphs/*`                                                      | Repository + Route Handlers          |
| Import readiness          | `src/aws/mcp.ts`                                                                            | MCP / Cloud Control ingestion        |

## Quick start

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. Graphs persist to a local file store under
`.data/graphs/` by default — no external infrastructure required.

The tech stack: Next.js (App Router) · React · TypeScript · Tailwind CSS.
