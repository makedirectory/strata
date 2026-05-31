// Ambient declarations for side-effect CSS imports (global stylesheets and the
// Nextra theme stylesheet). TypeScript 6 requires a type declaration for
// side-effect imports of non-code modules; the wildcard matches any `*.css`
// specifier, including package subpaths like "nextra-theme-docs/style.css".
declare module "*.css";
