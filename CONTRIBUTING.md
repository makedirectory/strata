# Contributing to Strata

Thanks for your interest in contributing! Strata is a registry-driven canvas for
modeling AWS infrastructure as a typed graph, and contributions of all kinds —
bug reports, new AWS services, docs, and features — are welcome.

By participating you agree to abide by our [Code of Conduct](./CODE_OF_CONDUCT.md).

## Table of contents

- [Ways to contribute](#ways-to-contribute)
- [Development setup](#development-setup)
- [Project layout](#project-layout)
- [Common workflows](#common-workflows)
  - [Adding a new AWS service](#adding-a-new-aws-service)
  - [Working with tests & snapshots](#working-with-tests--snapshots)
- [Quality gates](#quality-gates)
- [Commit & PR conventions](#commit--pr-conventions)
- [Reporting bugs & requesting features](#reporting-bugs--requesting-features)

## Ways to contribute

- **Report a bug** or **request a feature** via the [issue templates](https://github.com/makedirectory/aws-flow-builder/issues/new/choose).
- **Add an AWS service** to the registry — often a single catalog entry (see below).
- **Improve the docs** under `src/content/` (served at `/docs`).
- **Fix bugs or build features** — grab an open issue or open one to discuss first.

For larger changes, please open an issue or a [discussion](https://github.com/makedirectory/aws-flow-builder/discussions)
before sinking time into a PR, so we can align on direction.

## Development setup

Strata is a single Next.js app (product at `/`, docs at `/docs`).

**Prerequisites:** Node.js `>=22` (the version in [`.nvmrc`](./.nvmrc) is what CI
uses — run `nvm use` if you use nvm; CI tests on Node 22 and 24) and npm 10+.

```bash
git clone https://github.com/makedirectory/aws-flow-builder.git
cd aws-flow-builder
npm install
npm run dev
```

- Product: http://localhost:3000/
- Docs: http://localhost:3000/docs

Saved diagrams persist in the **browser** (`localStorage`, via `src/lib/localStore.ts`) —
no external infrastructure required, and it works on a read-only serverless host. The
server-side `Repository` + `/api/graphs` route remain in the tree for a future durable
backend but are no longer on the save/load path.

## Project layout

```
src/
  aws/                  Registry + domain model (the data foundation)
    types.ts              ServiceDefinition, ConfigField, RelationshipKind, scopes
    registry.ts           Aggregates catalogs; lookups, search, validateRegistry()
    categories.ts         Category + relationship presentation metadata
    model.ts              InfrastructureGraph / ResourceInstance / Relationship
    regions.ts            AWS region reference list
    rules.ts              Architecture validation + best-practice rule suggestions
    relationshipClasses.ts  Edge visual encoding (colour/dash/arrow per class)
    overlays.ts           Topology overlays (IAM-trust, network path, heat)
    iac.ts                IaC import (CloudFormation + Terraform → graph)
    iacExport.ts          IaC export (graph → CloudFormation / Terraform scaffold)
    mcp.ts                Pure transform: DiscoveredResource[] → graph
    discovery.ts          Cloud Control descriptions → DiscoveredResource[] (no SDK)
    services/             Per-category service catalogs (networking.ts is the template)
  canvas/               Pure geometry + containment layout (geometry.ts, layout.ts)
  server/               Retained server tier (kept for a future durable backend)
    repository.ts         Repository interface
    fileRepository.ts     Default file-backed store
    graphSchema.ts        Zod schema for graph validation
    auth.ts               Optional bearer-token guard (AWS_FLOW_API_TOKEN)
    index.ts              getRepository() — backend selection via env
  lib/
    localStore.ts         Browser localStorage save/load (the active persistence path)
    api.ts                Fetch client for the graph + discover APIs (discover is live)
  app/                  Next.js App Router
    (product)/            The Strata canvas app, served at /
    (docs)/              Nextra docs, served at /docs
    api/graphs/           Graph REST Route Handlers (GET/POST, GET/PUT/DELETE by id)
    api/discover/         Live discovery Route Handler (Cloud Control SDK, server-only)
  components/           UI: Palette, Canvas, Inspector, CommandPalette
  hooks/               Canvas state, rendering, interaction, undo/redo
  content/             Nextra MDX docs (User Guide + Architecture)
```

See [`README.md`](./README.md) for the full breakdown and the in-app
**Architecture & Engineering** docs at `/docs/architecture`.

### A note on "MCP-native"

Strata is described as **MCP-native**, but to be clear for contributors:
**there is no MCP server in this repository today.** The "MCP-native" framing
means the registry — typed relationships, `cfnType` join keys, config schemas —
is built as a substrate an LLM/agent can reason over, and as a future ingestion
path. Concretely:

- `src/aws/mcp.ts` is a **pure, dependency-free transform** (`mapDiscoveredToGraph`)
  that maps a flat `DiscoveredResource[]` onto the graph. It does not host or
  speak the Model Context Protocol.
- Live discovery today is a **Cloud Control SDK route** at
  `src/app/api/discover/route.ts` (server-only), fed by `src/aws/discovery.ts`.

So don't go looking for an MCP server process — it doesn't exist yet.

## Common workflows

### Adding a new AWS service

The core idea of Strata is that **everything visual is derived from the registry**.
Adding a service is usually a single catalog entry — no UI changes:

1. Open the matching catalog in `src/aws/services/` (use `networking.ts` as a
   template).
2. Append one `ServiceDefinition` (id, name, category, icon, `configFields`,
   `commonConnections`, optional `cfnType`).
3. Run `npm test` — the registry integrity tests (`src/aws/registry.test.ts`) and
   the snapshot tests will tell you immediately if something is off.
4. The palette, colours, icons, inspector form, and search pick it up
   automatically.

### Working with tests & snapshots

Tests live next to the code as `*.test.ts(x)` and run on Vitest + Testing Library
(jsdom). There are two kinds you'll touch most:

- **Unit / component tests** — e.g. `src/aws/registry.test.ts`, `src/components/Palette.test.tsx`.
- **Snapshot tests** — `*.snapshot.test.ts(x)`. These pin down the registry
  contract (per-category service lists, relationship vocabulary) and key rendered
  UI. When you change the registry or that UI **on purpose**, update the snapshots:

  ```bash
  npm run test:update   # re-record snapshots
  ```

  Then **review the snapshot diff** before committing — an unexpected change there
  usually means an unintended registry/UI change.

## Quality gates

CI runs these on every PR. Run them locally before pushing:

```bash
npm run typecheck     # tsc --noEmit
npm run lint          # next lint
npm run format:check  # prettier --check . (use `npm run format` to fix)
npm test              # vitest run
npm run build         # production build + docs prerender
```

A handy one-liner before opening a PR:

```bash
npm run format && npm run lint && npm run typecheck && npm test && npm run build
```

## Commit & PR conventions

- Branch off `main` (or the relevant feature branch) with a descriptive name,
  e.g. `feat/step-functions-service` or `fix/inspector-overflow`.
- Use [Conventional Commits](https://www.conventionalcommits.org/) for commit and
  PR titles: `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`, with an
  optional scope like `feat(aws): …`.
- Keep PRs focused and reasonably small. Fill out the PR template and link the
  issue you're closing.
- Update docs (`src/content/`) when you change behavior or architecture.

## Reporting bugs & requesting features

Use the [issue templates](https://github.com/makedirectory/aws-flow-builder/issues/new/choose).
For **security vulnerabilities**, do not open a public issue — instead follow the
[Security Policy](./SECURITY.md) and report privately via a
[draft security advisory](https://github.com/makedirectory/aws-flow-builder/security/advisories/new).

---

By contributing, you agree that your contributions will be licensed under the
project's [Apache License 2.0](./LICENSE).
