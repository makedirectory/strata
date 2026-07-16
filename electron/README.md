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
- **Durable storage (SQLite)** — diagrams persist to `<userData>/graphs.db`
  (`better-sqlite3`, one row per graph) via a synchronous whole-map preload bridge;
  `src/lib/localStore.ts` prefers it over `localStorage` when present. An existing
  `graphs.json` is migrated in on first run (kept as `graphs.json.migrated`). If the
  native module can't load, it falls back to the JSON file. See `electron/storage.cjs`.
  Web is unchanged.
- **Auto-update** — `electron/updater.cjs` (electron-updater) checks GitHub Releases
  on launch + every 6h, adds a `Tools ▸ Check for Updates…` item, and prompts to
  restart-and-install when a build is downloaded. Packaged builds only (`app.isPackaged`).
- **Code signing + notarization** — configured in `electron-builder.yml` +
  `electron/notarize.cjs` (afterSign) with a hardened-runtime entitlements file. All
  credentials come from **env vars only** (below).

## Signing, notarization & release

`app:dist` produces signed + notarized installers **and** the update metadata
(`latest-mac.yml`, `latest.yml`, …) when the credentials below are in the
environment. They are **never committed** — set them in your shell/keychain or as
CI secrets. Run `app:dist` on each target OS (macOS for dmg/zip, Windows for nsis).

**macOS** (Developer ID + notarytool):

| env var                       | purpose                                               |
| ----------------------------- | ----------------------------------------------------- |
| `CSC_LINK`                    | Developer ID Application cert (`.p12` path or base64) |
| `CSC_KEY_PASSWORD`            | password for that cert                                |
| `APPLE_ID`                    | Apple account email (notarization)                    |
| `APPLE_APP_SPECIFIC_PASSWORD` | app-specific password from appleid.apple.com          |
| `APPLE_TEAM_ID`               | Developer Team ID                                     |

Hardened runtime is on (`entitlements.mac.plist`) so notarization passes; the
entitlements cover V8 JIT, `ELECTRON_RUN_AS_NODE` (MCP + the forked Next server),
the native `better-sqlite3` addon, and spawning `terraform`. If any `APPLE_*` var
is unset, `notarize.cjs` no-ops so an unsigned local build still completes.

**Windows** (signtool): set `WIN_CSC_LINK` + `WIN_CSC_KEY_PASSWORD` (or the generic
`CSC_LINK` / `CSC_KEY_PASSWORD`). Unsigned if absent.

**Release (auto-update feed).** `publish: github` in `electron-builder.yml`. To cut
a release, set `GH_TOKEN` (a repo-scoped PAT) and run `app:dist` — electron-builder
uploads the installers + `latest-*.yml` to a GitHub Release. The running app reads
that feed. (Swap `publish` to a generic S3/HTTPS provider if you'd rather self-host.)

## Native module (better-sqlite3)

`better-sqlite3` is a native addon and an `optionalDependency` (a failed prebuild
never breaks the web `npm install`). electron-builder rebuilds it for Electron's ABI
at package time (`npmRebuild` is on by default) and `asarUnpack` keeps the `.node`
outside the asar. If a dev run hits an ABI mismatch, rebuild once with
`npx electron-builder install-app-deps`; the app also falls back to JSON storage if
the module still won't load.

`app:dist` can't be verified in CI here — run it on each target OS. The packaged
`--mcp` path (`ELECTRON_RUN_AS_NODE` + bundled `mcp.cjs`; `@cdktf/hcl2json` is
external, so the `connect_repo`/`import_plan` tools need it present) is
correct-by-design but validate it on first `app:dist`.
