# Strata desktop shell (Electron)

**Additive packaging.** Nothing here affects the web app or its build/deploy —
it's a separate target that bundles the _same_ Next.js app + Node runtime so an
average user can install Strata as a desktop app (and get the Node-only local
features: the Terraform companion, live discovery, and — later — a one-click MCP
setup).

## Scripts

```bash
# Dev: run the web app, then launch the shell against it (two terminals).
npm run dev
npm run app:dev            # ELECTRON_START_URL defaults to http://localhost:3000

# Build a self-contained Next server, then package installers into ./release
npm run app:build          # BUILD_TARGET=electron next build + copy static/public
npm run app:dist           # app:build + electron-builder (per-OS installers)
```

## How it works

- `next.config.mjs` emits `output: "standalone"` **only** when `BUILD_TARGET=electron`.
- `prepare-standalone.cjs` copies `.next/static` + `public` into `.next/standalone`
  (Next doesn't do this automatically).
- `electron-builder.yml` packages `electron/` into the asar and ships
  `.next/standalone` as an unpacked extra resource.
- `main.cjs` forks the standalone `server.js` on a local port and loads it; in dev
  it just loads the running `next dev`.

## Done (desktop-only, additive)

- **One-click MCP setup** — `Tools ▸ Connect to Claude Desktop… / Cursor` merges
  the Strata server into the client config (`main.cjs` → `connectClient`). Packaged
  it points at `Strata --mcp` (the `--mcp` guard runs the esbuild-bundled
  `mcp.cjs`); dev points at `npm run mcp`.
- **Durable storage** — diagrams persist to `<userData>/graphs.json` via a
  synchronous preload bridge; `src/lib/localStore.ts` prefers it over
  `localStorage` when present. Web is unchanged.

## Not done yet (needs your machine / decisions)

- **Code signing + notarization** (macOS) and auth for Windows — required for a
  distributable, non-quarantined app. Add certs to electron-builder.
- **Auto-update** feed (electron-updater).
- **SQLite** instead of the JSON storage file, for very large libraries.

`app:dist` can't be verified in CI here — run it on each target OS. The packaged
`--mcp` path (`ELECTRON_RUN_AS_NODE` + bundled `mcp.cjs`; `@cdktf/hcl2json` is
external, so the `connect_repo`/`import_plan` tools need it present) is
correct-by-design but validate it on first `app:dist`.
