"use strict";
/**
 * Bundle the stdio MCP server into a single CJS file (`electron/mcp.cjs`) so the
 * packaged desktop app can run it via `Strata --mcp` (see electron/main.cjs).
 * Run by `npm run app:build`.
 *
 * `@cdktf/hcl2json` (a Go/WASM bridge, also externalised in next.config) can't be
 * bundled and is only needed by the `connect_repo` / `import_plan` MCP tools; the
 * core tools (registry, validate, cost, import_iac, merge, export) don't touch it.
 */
const path = require("path");
const esbuild = require("esbuild");

const root = path.join(__dirname, "..");

esbuild
  .build({
    entryPoints: [path.join(root, "src", "mcp", "bin.ts")],
    outfile: path.join(__dirname, "mcp.cjs"),
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    external: ["@cdktf/hcl2json"],
    logLevel: "info",
  })
  .then(() => console.log("bundled MCP server → electron/mcp.cjs"))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
