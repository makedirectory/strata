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

Saved diagrams persist in **your browser** (`localStorage`) — **no external
infrastructure required**, and it works on a read-only serverless host. Use
**Export / Import JSON** to move a diagram between browsers or share it. (The
server-side `Repository` + `/api/graphs` route remain for a future durable
backend, but the app no longer relies on them for saving.)

### Other scripts

```bash
npm run build   # production build (compiles the product and prerenders the docs)
npm run start   # run the production build
npm run lint    # lint
npm test        # run the Vitest suite
```

### Configuration

| Env var                     | Default        | Purpose                                                               |
| --------------------------- | -------------- | --------------------------------------------------------------------- |
| `AWS_FLOW_REPOSITORY`       | `file`         | Persistence backend (`file`; `postgres`/`dynamodb` are designed-for). |
| `AWS_FLOW_DATA_DIR`         | `.data/graphs` | Directory for the file-backed store.                                  |
| `AWS_FLOW_API_TOKEN`        | _(unset)_      | If set, the graph API requires `Authorization: Bearer <token>`.       |
| `NEXT_PUBLIC_STRATA_HOSTED` | _(unset)_      | Set to `1` on any **shared/hosted** deployment (see below).           |

#### Live discovery & credentials

The **Connect to AWS → Live scan** flow runs server-side. With no credentials in
the request, it uses the server process's _default credential chain_ (env vars /
shared profile / SSO / instance role) — fine for a **single-user local** run,
where those are your own credentials.

On a **shared/hosted** deployment that ambient chain would be the _operator's_
account, so any visitor could enumerate it. Set **`NEXT_PUBLIC_STRATA_HOSTED=1`**
(at build _and_ runtime) to disable the ambient fallback: each user must then
bring their own AWS credentials, entered in the modal and sent over HTTPS for a
single scan. Those keys are used in-memory only — never written to disk, logged,
returned, or saved into a diagram. Users should supply **temporary, read-only**
credentials (e.g. `aws sts get-session-token`, or an assumed `ReadOnlyAccess`
role). The credential-free **Paste export** tab remains available either way.

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
