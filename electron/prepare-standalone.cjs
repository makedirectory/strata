"use strict";
/**
 * Post-build step for the Electron bundle: Next's `output: "standalone"` emits a
 * minimal server + traced node_modules under `.next/standalone`, but does NOT
 * copy the static assets or `public/` into it. This copies them in so the bundled
 * server can serve them. Run by `npm run app:build` after the Next build.
 *
 * Web-build-safe: only touches `.next/standalone`, which only exists when built
 * with BUILD_TARGET=electron.
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const standalone = path.join(root, ".next", "standalone");

if (!fs.existsSync(standalone)) {
  console.error(
    "No .next/standalone found — run `BUILD_TARGET=electron next build` first (see npm run app:build).",
  );
  process.exit(1);
}

const copies = [
  [path.join(root, ".next", "static"), path.join(standalone, ".next", "static")],
  [path.join(root, "public"), path.join(standalone, "public")],
];

for (const [from, to] of copies) {
  if (!fs.existsSync(from)) continue;
  fs.rmSync(to, { recursive: true, force: true });
  fs.cpSync(from, to, { recursive: true });
  console.log(`copied ${path.relative(root, from)} → ${path.relative(root, to)}`);
}

console.log("standalone bundle ready for electron-builder.");
