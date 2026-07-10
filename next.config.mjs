import nextra from "nextra";

/**
 * Nextra powers the documentation under `/docs` (content in `src/content`,
 * served via the `(docs)` route group). The product app lives in `(product)`.
 * One Next.js app, one build, one deploy.
 */
const withNextra = nextra({
  contentDirBasePath: "/docs",
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  // `@cdktf/hcl2json` ships a Go/WASM bridge that references Node-only globals
  // (e.g. `performance`) which webpack can't bundle. It's only used server-side
  // by the repo/plan routes, so keep it external (required at runtime).
  serverExternalPackages: ["@cdktf/hcl2json"],
  // Electron packaging only: emit a self-contained server under
  // `.next/standalone`. Gated on BUILD_TARGET so the normal web build/deploy is
  // completely unchanged (see `electron/` + `npm run app:build`).
  ...(process.env.BUILD_TARGET === "electron" ? { output: "standalone" } : {}),
};

export default withNextra(nextConfig);
