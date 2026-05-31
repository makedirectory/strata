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
const nextConfig = {};

export default withNextra(nextConfig);
