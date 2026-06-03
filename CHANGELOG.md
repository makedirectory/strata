# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.5.0] - 2026-06-02

Operability & polish: compare a design against any baseline (and see the cost
delta), reconcile re-scans instead of duplicating, keep local version history,
OpenTofu support — plus a focused-review pass over correctness, accessibility,
and docs.

### Added

- **Compare for drift against more baselines.** Beyond a file, compare the canvas
  against **a saved diagram** or a **version-history snapshot**; the drift panel
  now also shows an **estimated monthly cost delta** (baseline → current) next to
  the added/removed/changed counts.
- **ARN-keyed merge-upsert** (`src/aws/merge.ts`). Re-running discovery or
  re-importing IaC now **reconciles** into the current graph (matched by ARN, else
  service type + name) — updating in place and preserving canvas position — instead
  of appending duplicates. A re-scan adopts the live name.
- **Merge preview.** "Merge into canvas" opens a **Review merge** dialog (added /
  updated / unchanged / kept) before anything is applied.
- **Local version history** (`src/lib/snapshots.ts`). **Data ▾ → Version history…**
  snapshots the diagram to a bounded `localStorage` ring; restore one, or use it as
  a drift/cost baseline. (Cross-device history is gated on the sharing backend.)
- **OpenTofu support.** Import/compare pickers accept `.tofu`; the IaC import/export
  labels read **Terraform / OpenTofu**; `tofu show -json` imports identically.
- **Network-paths overlay** now traces load-balancer (`targets`) chains and
  distinguishes **internal vs internet-facing** edges (orange), with a legend.
- **Keyboard & screen-reader access to the canvas** (`AccessibleNodes` +
  `navGrid.ts`): spatial arrow-key navigation, plus focus-trapped modal dialogs.

### Changed

- **Left panel slimmed:** removed the legacy **Presets** and **Shortcuts** sections
  (starting points live in the Start hub; shortcuts in the **Intro**, renamed from
  "? Tour").
- **Cost "coming soon"** prompt rewritten to be benefit-first.
- **Docs:** a full freshness pass — new user docs for version history, image
  export, share links, and the merge preview; OpenTofu across the IaC guides; the
  MCP server, cost, drift, merge, and snapshot engines reflected in the
  architecture docs and Layer map; many stale menu/label references corrected.
  README gains a product screenshot and live (non-localhost) doc links.

### Fixed

- Analytical overlays no longer grey the whole canvas when there's nothing to
  highlight; the validation badge no longer overlaps the zoom controls; the active
  cost toggle stays legible on hover; the compare list and a re-scan's cost no
  longer mis-render.
- A batch of verified engine fixes: drift N-to-N identity matching, spatial-nav
  ordering, pan-delta accumulation, group-drag of nested children, cost clamping,
  security-group port parsing, ALB multi-AZ checking, tiered-arrange cycles,
  object-URL leaks, and corrupt-`localStorage` hardening.

## [0.4.0] - 2026-06-02

Depth + reach: make the design _trustworthy_ (compare it against reality with
drift detection), _legible_ to everyone (keyboard + screen-reader access to the
canvas), _automatable_ (an MCP server), and _sharper on cost_.

### Added

- **Drift detection** — compare the diagram against a baseline (a live cloud
  export, an IaC file, or a saved Strata JSON) and see what's **added / removed
  / changed**. A pure `diffGraphs` engine (`src/aws/drift.ts`) matches resources
  across sources by ARN — else service type + name — rather than by id, so a
  diagram's internal ids still line up with an import's logical ids. Drifted
  nodes are dotted on the canvas (green = added, amber = changed) with a results
  panel; reached from **File → Compare for drift…**.
- **Keyboard navigation & screen-reader access for the canvas** (a11y round 2).
  The diagram now exposes an accessible `role="application"` layer: Tab in, then
  **arrow keys** move spatially between nodes (pure `src/canvas/navGrid.ts`),
  **Enter** opens a container or recentres a leaf, **Esc** steps out, **Home/End**
  jump. Focus selects the node and announces its name, type, cloud provider, and
  container.
- **Accessibility pass (round 1)** — focus-visible rings, reduced-motion support,
  icon-button `aria-label`s, and a labelled canvas region.
- **MCP server** (`src/mcp/`) — exposes the registry, validation, IaC
  import/export, and cost tools over stdio (`npm run mcp`) so agents can drive
  Strata headlessly. Dependency-free JSON-RPC.
- **Deeper cost estimates** — the heuristic now refines by instance size/class,
  count/capacity, Multi-AZ, and storage for the big-ticket compute and database
  services (`src/aws/cost.ts`), instead of a flat per-service figure.
- **Cost-optimization "coming soon"** — an interest-capture prompt that records
  demand (event + localStorage + optional webhook) before deeper cost
  optimization is built.

### Changed

- Docs refreshed: new **Drift Detection** and **Estimated Cost** user guides, a
  **Drift Detection Engine** architecture page, a keyboard-navigation section in
  the shortcuts reference, and an updated roadmap.

## [0.3.0] - 2026-06-01

A large usability + breadth release: get value _out_ of a diagram (images, share
links, cost), trust it (always-on Well-Architected validation), and reach it
more easily (tiered auto-arrange, clean templates, a first-run tour).

### Added

- **Image export** — download the diagram as a vector **SVG** or rasterised
  **PNG** (`src/canvas/imageExport.ts`); embeddable in docs, slides and READMEs.
- **Always-on validation** — findings recompute live on every change, flagged
  nodes get a severity dot, and a corner findings panel lists them with counts
  (click to focus the node). Findings carry a `resourceId`.
- **Cost estimate overlay** — a rough monthly $ per resource plus a diagram
  total (`src/aws/cost.ts`), toggled from the toolbar.
- **Share links** — pack a diagram into the URL hash (`#g=…`) for backend-free
  read-to-edit sharing (`src/lib/shareLink.ts`).
- **Tiered, relationship-aware auto-arrange** (`src/canvas/arrange.ts`) behind
  the Tidy button; templates and IaC imports now open already-arranged.
- **Resizable nodes & containers** — corner handles; containers treat stored
  size as a minimum that the auto-fit layout never shrinks below.
- **Editable diagram name** — saves persist the user's name (no longer the
  hardcoded "AWS Architecture").
- **First-run guided tour** (with a ⌘K command-palette step), an in-app
  **Examples gallery**, and new **Templates** (Serverless API, Static Website).
- **Expanded Well-Architected validation** — encryption-at-rest, public
  exposure (S3/RDS/GCS/Azure), open security-group/firewall ports, IMDSv2,
  TLS/HTTPS, DynamoDB PITR, deletion protection, idle EBS, single-NAT-across-AZs,
  CloudFront-without-WAF; provider-aware across AWS/GCP/Azure.
- **Config-field accuracy** (secure-by-default fields) across AWS/GCP/Azure, six
  new Azure services, a distinct Route 53 record service, more Terraform/CFN/ARM
  type mappings, and S3 secure-config export transforms (CloudFormation +
  Terraform). Larger mock-data examples + a multi-module Terraform-state fixture.

### Changed

- Node baseline bumped to **24** (`.nvmrc`, `engines`, CI) to match Vercel.
- README/CONTRIBUTING reworded to **cloud** (multi-cloud) infrastructure; README
  links the live app (strata.mk-dir.com).

### Fixed

- **Deep nesting** no longer renders "out of bounds" (removed a `.node`
  `max-width` clamp that collapsed container backplates).
- **Drag-to-reparent** targets the container under the cursor, so deep nesting is
  reliable.
- **Container focus** is released by an empty-canvas click (was stuck).
- **Presentation mode** renders the canvas (fixed a CSS-grid auto-placement
  collapse that blanked the screen).

## [0.2.1] - 2026-05-31

### Added

- **Export to IaC** — generate CloudFormation (JSON/YAML) and Terraform (HCL)
  from the graph (`src/aws/iacExport.ts`). Output is an honest scaffold a human
  finishes: correct resource types and dependencies, but property names follow
  Strata's config model, not the full provider schema.
- **Live discovery (Connect to AWS)** — a server-side Cloud Control route
  (`/api/discover`) that imports a live account slice into the graph, plus a
  credential-free **Paste export** tab for `aws cloudcontrol list-resources`
  output (`src/aws/discovery.ts`, `src/aws/mcp.ts`).
- **Bring-your-own AWS credentials** for hosted live scans: credentials are
  per-request, used in-memory only, and never persisted, logged, or returned.
  Set `NEXT_PUBLIC_STRATA_HOSTED=1` to disable the ambient-credential fallback
  on shared deployments.
- Discovery UX: "Connect to AWS" entry in the toolbar menu, a privacy notice,
  and a select-all toggle for resource types.

### Changed

- Upgraded test tooling to Vitest 4 / coverage-v8 8, TypeScript 6, and
  `@types/node` 25; refreshed in-range dependencies and CI actions.

### Security

- Cleared PostCSS advisories; risky major upgrades held via Dependabot ignore.

## [0.2.0]

### Added

- Registry-driven AWS service catalog (~101 services across categories) with
  integrity tests and snapshot coverage of the registry contract.
- Visual canvas: palette, drag-and-drop, inspector, and undo/redo.
- Import of Terraform and CloudFormation as visual diagrams.
- Local file-backed graph persistence under `.data/graphs/`.
- Embedded Nextra documentation served at `/docs` (User Guide + Architecture).
- Open-source project scaffolding: CI (typecheck, lint, format, test, build),
  CodeQL analysis, Dependabot, issue/PR templates, and contributor docs.

[Unreleased]: https://github.com/makedirectory/aws-flow-builder/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/makedirectory/aws-flow-builder/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/makedirectory/aws-flow-builder/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/makedirectory/aws-flow-builder/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/makedirectory/aws-flow-builder/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/makedirectory/aws-flow-builder/releases/tag/v0.2.0
