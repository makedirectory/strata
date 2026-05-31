# Strata

A registry-driven canvas for **modeling AWS infrastructure as a typed graph**.
Drag services onto a canvas, configure them with auto-generated forms, and connect
them with typed relationships (`contains`, `routes_to`, `invokes`, `peers_with`, …)
— with the whole vocabulary spanning 14 AWS service categories. It can also import
existing Infrastructure-as-Code — CloudFormation (JSON/YAML) and Terraform
`show -json` — into the same graph, and is built to eventually ingest live AWS
state via MCP / Cloud Control.

The core idea: **everything visual is derived from a data registry, not hardcoded.**
Adding a new AWS service is a single catalog entry — no UI changes.

Strata is **open source**. Contributions welcome.

## Documentation

Strata ships its docs as part of the app, served at **`/docs`**, in two public
sections:

- **User Guide** (`/docs/guide`) — how to use the app: building diagrams, importing
  IaC, validation, and saving/loading.
- **Architecture & Engineering** (`/docs/architecture`) — how it works internally:
  the service registry, domain model, persistence, MCP/IaC import, testing, and the
  roadmap.

The docs are authored as Nextra MDX under `src/content/`.

## Quick Start

Strata is now a **single app**: `npm run dev` serves the product at `/` and the docs
at `/docs`.

```bash
npm install
npm run dev
```

- Product: http://localhost:3000/
- Docs: http://localhost:3000/docs

Graphs persist to a local file store under `.data/graphs/` by default — **no
external infrastructure required**.

### Other scripts

```bash
npm run build   # production build (compiles the product and prerenders the docs)
npm run start   # run the production build
npm run lint    # lint
npm test        # run the Vitest suite
```

### Configuration

| Env var               | Default        | Purpose                                                               |
| --------------------- | -------------- | --------------------------------------------------------------------- |
| `AWS_FLOW_REPOSITORY` | `file`         | Persistence backend (`file`; `postgres`/`dynamodb` are designed-for). |
| `AWS_FLOW_DATA_DIR`   | `.data/graphs` | Directory for the file-backed store.                                  |

## Project Structure

```
src/
  aws/                  Registry + domain model (the data foundation)
    types.ts            ServiceDefinition, ConfigField, RelationshipKind, scopes
    registry.ts         Aggregates catalogs; lookups, search, validateRegistry()
    categories.ts       Category + relationship presentation metadata
    model.ts            InfrastructureGraph / ResourceInstance / Relationship, validateGraph()
    regions.ts          AWS region reference list
    rules.ts            Architecture validation + best-practice rule suggestions
    services/*.ts       Per-category service catalogs (networking.ts is the template)
    mcp.ts              MCP / Cloud Control import mapper (mapDiscoveredToGraph)
    iac.ts              Infrastructure-as-Code import (CloudFormation + Terraform → InfrastructureGraph)
  server/               Persistence (the Route Handlers are the server tier)
    repository.ts       Repository interface
    fileRepository.ts   Default file-backed store
    index.ts            getRepository() — backend selection via env
  app/
    (product)/          The Strata canvas app, served at /
    (docs)/             Nextra docs, served at /docs
    api/graphs/         REST Route Handlers (GET/POST, GET/PUT/DELETE by id)
  components/           UI: Palette, Canvas, Inspector
  hooks/                Canvas state, rendering, interaction, undo/redo
  content/              Nextra MDX docs (User Guide + Architecture), served at /docs
```

### Adding a new AWS service

Append one `ServiceDefinition` to the matching catalog in `src/aws/services/`
(use `networking.ts` as the template) — the palette, colours, icons, inspector
form, and search pick it up automatically. See the
[Service Registry docs](http://localhost:3000/docs/architecture/service-registry).

## Architecture

For the full design — registry schema, domain model, the registry-driven UI, the
swappable persistence layer, MCP ingestion readiness, and a candid list of gaps and
next steps — see the **[Architecture & Engineering docs](http://localhost:3000/docs/architecture)**
(`src/content/architecture/`).

## Tech Stack

Next.js (App Router) · React · TypeScript · Tailwind CSS · Nextra (docs).
