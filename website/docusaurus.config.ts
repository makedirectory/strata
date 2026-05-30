import { themes as prismThemes } from "prism-react-renderer";
import type { Config } from "@docusaurus/types";
import type * as Preset from "@docusaurus/preset-classic";

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

const GITHUB_REPO = "https://github.com/your-org/aws-flow-builder";

const config: Config = {
  title: "AWS Flow Builder",
  tagline: "Model AWS infrastructure as a typed, registry-driven graph",
  favicon: "img/favicon.ico",

  // Future flags, see https://docusaurus.io/docs/api/docusaurus-config#future
  future: {
    v4: true, // Improve compatibility with the upcoming Docusaurus v4
  },

  // Set the production url of your site here
  url: "https://aws-flow-builder.example.com",
  // Set the /<baseUrl>/ pathname under which your site is served
  baseUrl: "/",

  organizationName: "your-org",
  projectName: "aws-flow-builder",

  onBrokenLinks: "throw",

  i18n: {
    defaultLocale: "en",
    locales: ["en"],
  },

  presets: [
    [
      "classic",
      {
        docs: {
          sidebarPath: "./sidebars.ts",
          editUrl: `${GITHUB_REPO}/tree/main/website/`,
        },
        blog: false,
        theme: {
          customCss: "./src/css/custom.css",
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    colorMode: {
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: "AWS Flow Builder",
      items: [
        {
          type: "docSidebar",
          sidebarId: "docsSidebar",
          position: "left",
          label: "Docs",
        },
        {
          href: GITHUB_REPO,
          label: "GitHub",
          position: "right",
        },
      ],
    },
    footer: {
      style: "dark",
      links: [
        {
          title: "Docs",
          items: [
            {
              label: "Overview",
              to: "/docs/intro",
            },
            {
              label: "Service Registry",
              to: "/docs/service-registry",
            },
            {
              label: "MCP Integration",
              to: "/docs/mcp-integration",
            },
          ],
        },
        {
          title: "Project",
          items: [
            {
              label: "GitHub",
              href: GITHUB_REPO,
            },
            {
              label: "Roadmap",
              to: "/docs/roadmap",
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} AWS Flow Builder. Built with Docusaurus.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
