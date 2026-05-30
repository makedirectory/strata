# AWS Flow Builder

A registry-driven canvas for **modeling AWS infrastructure as a typed graph**.
Drag services onto a canvas, configure them with auto-generated forms, and connect
them with typed relationships (`contains`, `routes_to`, `invokes`, `peers_with`, …)
— with the whole vocabulary spanning 14 AWS service categories. It is built to be
extended one service at a time and to eventually ingest live AWS state via MCP /
Cloud Control.

The core idea: **everything visual is derived from a data registry, not hardcoded.**
Adding a new AWS service is a single catalog entry — no UI changes.

## Quick Start

```bash
npm install
npm run dev
```

Open http://localhost:3000.

Graphs persist to a local file store under `.data/graphs/` by default — **no
external infrastructure required**.

### Other scripts

```bash
npm run build   # production build
npm run start   # run the production build
npm run lint    # lint
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
  server/               Persistence (the Route Handlers are the server tier)
    repository.ts       Repository interface
    fileRepository.ts   Default file-backed store
    index.ts            getRepository() — backend selection via env
  app/
    api/graphs/         REST Route Handlers (GET/POST, GET/PUT/DELETE by id)
    page.tsx, layout.tsx
  components/           UI: Palette, Canvas, Inspector
  hooks/                Canvas state, rendering, interaction, undo/redo
```

### Adding a new AWS service

Append one `ServiceDefinition` to the matching catalog in `src/aws/services/`
(use `networking.ts` as the template) — the palette, colours, icons, inspector
form, and search pick it up automatically. See
[ARCHITECTURE.md §2](./ARCHITECTURE.md#2-the-service-registry--schema).

## Architecture

For the full design — registry schema, domain model, the registry-driven UI, the
swappable persistence layer, MCP ingestion readiness, and a candid list of gaps and
next steps — see **[ARCHITECTURE.md](./ARCHITECTURE.md)**.

## Tech Stack

Next.js (App Router) · React · TypeScript · Tailwind CSS.
