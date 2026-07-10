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

## Not done yet (needs your machine / decisions)

- **Code signing + notarization** (macOS) and auth for Windows — required for a
  distributable, non-quarantined app. Add certs to electron-builder.
- **Auto-update** feed (electron-updater).
- **One-click MCP setup** — write `claude_desktop_config.json` / Cursor config
  pointing at a bundled MCP server (the `preload.cjs` contextBridge is the seam).
- **Durable storage** — swap `localStorage` for SQLite/a file via the existing
  `src/server/` Repository tier.

`app:dist` can't be verified in CI here — run it on each target OS.
