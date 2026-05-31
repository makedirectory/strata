# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/makedirectory/aws-flow-builder/compare/v0.2.1...HEAD
[0.2.1]: https://github.com/makedirectory/aws-flow-builder/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/makedirectory/aws-flow-builder/releases/tag/v0.2.0
