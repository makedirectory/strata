# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev            # Next.js dev server — product at /, docs at /docs (localhost:3000)
npm run build          # production build + prerender docs
npm test               # vitest run (one-shot)
npm run test:watch     # vitest watch mode
npm run test:update    # re-record snapshots (*.snapshot.test.ts) — see caveat below
npm run test:coverage  # vitest with v8 coverage
npm run typecheck      # tsc --noEmit
npm run lint           # next lint
npm run format         # prettier --write .   (format:check for CI-style check)
npm run mcp            # run the MCP server over stdio (npx tsx, no build step)
```

Run a single test file or pattern (vitest passes args through):

```bash
npm test -- src/aws/registry.test.ts        # one file
npm test -- -t "validates relationships"    # by test-name substring
```

Pre-PR gate (CI runs all of these on Node 22 and 24; local Node is `>=24`):

```bash
npm run format && npm run lint && npm run typecheck && npm test && npm run build
```

## The core architectural invariant

**Everything visual and analytical is derived from the service registry — nothing
about a cloud service is hardcoded in the UI.** The palette, node colours/icons,
the auto-generated inspector form, search, validation, IaC import/export, and cost
all read from `src/aws/registry.ts`, which aggregates per-category catalogs.

Consequence: **adding a service is a single `ServiceDefinition` entry** in the
matching catalog under `src/aws/services/` (or `src/gcp/services/`,
`src/azure/services/`). Use `src/aws/services/networking.ts` as the template. Do
not add UI branches for specific services — if you find yourself special-casing a
service in a component, the data probably belongs in its `ServiceDefinition`
instead.

The cross-provider join key is **`nativeType`** (CloudFormation type for AWS, Cloud
Asset Inventory type for GCP, ARM type for Azure). AWS entries fall back to
`cfnType`, so existing AWS catalogs need no edit. This key is what ties a registry
entry to IaC import/export and live-discovery mapping.

## Layout & data flow

- `src/aws/` — registry + domain model + the **pure analysis engines**. The model
  is `InfrastructureGraph` / `ResourceInstance` / `Relationship` (`model.ts`).
  Engines like `rules.ts` (validation), `autofix.ts`, `reachability.ts`,
  `review.ts`, `cloudMap.ts`, `receipt.ts`, `tags.ts`, `dsl.ts`, `overlays.ts`,
  `iac.ts` / `iacExport.ts` are **pure** — no DOM, network, or credentials. Keep
  them that way; they are shared by the UI and the MCP server.
- `src/gcp/`, `src/azure/` — per-provider catalogs, IaC, and discovery. AWS is the
  baseline provider (`serviceProvider()` defaults to `"aws"`).
- `src/mcp/server.ts` — MCP server (stdio). It is a **thin wrapper over the same
  pure engines** the app uses, exposing tools like `validate_architecture`,
  `import_iac`, `export_iac`, `estimate_cost`, `review_account`,
  `evaluate_reachability`, `apply_autofix`, `graph_to_dsl`. When adding/changing an
  engine, wire it through here too. Note `src/aws/mcp.ts` is unrelated despite the
  name — it is the pure `mapDiscoveredToGraph` transform, not the MCP server.
- `src/components/` (Canvas, Palette, Inspector, …) + `src/hooks/` (useFlowStore,
  useHistory, useCanvasInteraction/Renderer) — the registry-driven UI. `src/canvas/`
  holds pure geometry/containment layout.
- `src/app/(product)/` is served at `/`; `src/app/(docs)/` is Nextra MDX served at
  `/docs` (authored under `src/content/`).

## Persistence

The **active save path is browser `localStorage`** via `src/lib/localStore.ts` — no
external infrastructure required; the app runs on a read-only serverless host.
`src/server/` (Repository, `/api/graphs`) is retained for a future durable backend
but is **not on the save/load path** — don't assume the server tier is live.

**Live cloud discovery is the exception** — it runs server-side through
`src/app/api/discover/route.ts` (Cloud Control / provider SDKs). `src/aws/mcp.ts`
(`mapDiscoveredToGraph`) and `src/aws/discovery.ts` are the pure transforms behind
it. On a shared/hosted deploy set `NEXT_PUBLIC_STRATA_HOSTED=1` to disable the
ambient-credential fallback so visitors can't enumerate the operator's account.

## Tests & snapshots

Tests live next to code as `*.test.ts(x)` (Vitest + Testing Library / jsdom).
`*.snapshot.test.ts(x)` pin the registry contract (per-category service lists,
relationship vocabulary) and key rendered UI. After an **intentional** registry/UI
change, run `npm run test:update` and **review the snapshot diff before committing**
— an unexpected diff there usually means an unintended registry change.
`src/aws/registry.test.ts` (integrity) and the snapshot tests are the fastest signal
that a new catalog entry is malformed.

## Conventions

Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, optional scope
like `feat(aws):`). Branch off `main`. Update `src/content/` docs when behavior or
architecture changes.
