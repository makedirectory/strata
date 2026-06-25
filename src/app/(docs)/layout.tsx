import { Footer, Layout, Navbar } from "nextra-theme-docs";
import { Head } from "nextra/components";
import { getPageMap } from "nextra/page-map";
import type { ReactNode } from "react";
import "nextra-theme-docs/style.css";

/**
 * Root layout for the documentation site at `/docs`. Separate from the product
 * root layout (`(product)/layout.tsx`) so Nextra's theme CSS is isolated from
 * the product's styles. Both ship in a single Next.js app / deploy.
 */
export const metadata = {
  title: {
    default: "Strata Docs",
    template: "%s – Strata Docs",
  },
  description: "User and engineering documentation for Strata.",
};

// Open-source project — point this at the public repository.
const REPO = "https://github.com/makedirectory/strata";

const navbar = <Navbar logo={<b>🔶 Strata</b>} projectLink={REPO} />;
const footer = <Footer>MIT — Strata · open source</Footer>;

export default async function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <Head />
      <body>
        <Layout
          navbar={navbar}
          footer={footer}
          pageMap={await getPageMap()}
          docsRepositoryBase={`${REPO}/tree/main`}
        >
          {children}
        </Layout>
      </body>
    </html>
  );
}
