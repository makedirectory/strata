import type { SidebarsConfig } from "@docusaurus/plugin-content-docs";

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

/**
 * Explicit, ordered docs sidebar for AWS Flow Builder.
 */
const sidebars: SidebarsConfig = {
  docsSidebar: [
    "intro",
    "service-registry",
    "data-model",
    "visual-mapping",
    "persistence",
    "mcp-integration",
    "testing",
    "roadmap",
  ],
};

export default sidebars;
