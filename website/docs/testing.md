---
sidebar_position: 7
title: Testing
---

# Testing

## Setup (Vitest)

Tests run on [Vitest](https://vitest.dev/) configured in `vitest.config.ts`:

```ts
export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.{test,spec}.{ts,tsx}", "src/**/*.d.ts"],
    },
  },
});
```

`vitest.setup.ts` pulls in `@testing-library/jest-dom/vitest` for DOM matchers.
The `react` and `tsconfig-paths` Vite plugins give component tests JSX support
and `@/` path-alias resolution. The jsdom environment lets UI code run without a
browser. Test files live next to the code they cover as
`*.test.ts(x)` / `*.spec.ts(x)` under `src/`.

## Running

```bash
npm test            # vitest run — single pass (CI mode)
npm run test:watch  # vitest — watch mode
npm run test:coverage  # vitest run --coverage — v8 coverage, text + html reports
```

## What's covered

The current suite is small. `src/server/graphSchema.test.ts` exercises the
runtime shape validators in `src/server/graphSchema.ts`
(`hasGraphCollections`, `isInfrastructureGraph`) — the boundary checks that
guard request bodies and on-disk JSON before they are treated as an
`InfrastructureGraph`. Expanding coverage to the registry, domain model, and MCP
importer is a [roadmap](./roadmap.md) item.

## Validators as CI guardrails

Two validators are designed to be the first line of defence and should be run in
CI over fixtures:

- **`validateRegistry()`** (`src/aws/registry.ts`) — catches duplicate service
  ids, unknown categories, dangling `commonConnections` targets, and `cfnType`
  collisions.
- **`validateGraph()`** (`src/aws/model.ts`) — catches duplicate resource ids,
  `parentId`s pointing at missing resources, and relationships referencing
  missing endpoints.

Today `validateRegistry()` runs at module load and `validateGraph()` runs on
every API write. Wrapping both in tests that fail the build on any reported
issue closes the gap. See [Roadmap → item 6](./roadmap.md).
