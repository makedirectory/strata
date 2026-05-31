import { useMDXComponents as getThemeComponents } from "nextra-theme-docs";

const themeComponents = getThemeComponents();

/**
 * Merge Nextra's docs-theme MDX components with any overrides. Required by
 * Nextra 4's App Router integration (referenced by the docs catch-all route).
 */
export function useMDXComponents(components?: Record<string, React.ComponentType>) {
  return { ...themeComponents, ...components };
}
