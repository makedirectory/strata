# Roadmap

A living, public roadmap for Strata. Tracking doc, not a committed plan — each
item gets its own PR when picked up. Sizes are rough (S/M/L/XL). For shipped
detail see [`CHANGELOG.md`](./CHANGELOG.md); for how the pieces fit together see
[`README.md`](./README.md).

The guiding constraint today: Strata is a **front-end / pure-engine** app with no
backend or database — diagrams live in the browser (`localStorage`) and sharing
is a URL hash. Anything that needs durable multi-user storage, auth, a network
proxy, or live credentials is **deferred by design** until a persistence tier
exists (see _Deferred_ below).

## Recently shipped

A batch of eight front-end features, each a self-contained pure engine under
`src/aws/` (with co-located tests) wired through the registry-driven canvas and
the MCP server:

- **Explain & Clean review** (`review.ts`, MCP `review_account`) — cost map + risk
  findings + a safe-cleanup checklist.
- **Policy-aware reachability** (`reachability.ts`, MCP `evaluate_reachability`) —
  true internet-reachability evaluation (subnets/routes/SG ports), surfaced as a
  `reachability` overlay; distinct from the topology overlays.
- **Cross-cloud migration** (`cloudMap.ts`, MCP `map_to_cloud`) — equivalence
  mapping with an honest `unmapped[]` report.
- **Diagram-as-Code DSL** (`dsl.ts`, MCP `graph_to_dsl` / `graph_from_dsl`) —
  graph ⇄ YAML round-trip (including canvas positions).
- **Validation autofix** (`autofix.ts`, MCP `list_autofixes` / `apply_autofix`) —
  deterministic, VPC-scoped fixes routed through undo.
- **Change / audit receipt** (`receipt.ts`, MCP `change_receipt`) — what changed
  between two graphs (resource churn + cost delta + new/resolved findings).
- **Tag filter + tint** (`tags.ts`, MCP `tag_report`) — a `tags` overlay + a
  renderer tint channel.
- **Annotation layer** (`annotations.ts`) — notes / callouts / zones with a full
  canvas authoring UI (create, drag, resize, inline + Inspector edit), persisted
  in the graph and excluded from rules/cost/IaC.

Earlier lines: drift / compare UI, cost-diff, local version history, ARN
merge-upsert, multi-cloud (AWS/GCP/Azure) catalog + IaC, OpenTofu support, the
MCP server, and the Well-Architected rule set.

The review follow-ups for the annotation batch are now also shipped:

- **Canvas projection + drag unified** — a shared `worldToScreen` /
  `screenDeltaToWorld` / `snapToGrid` / `DRAG_THRESHOLD_PX` in
  `src/canvas/geometry.ts`; the annotation overlay and the node overlay share
  them, and annotation wiring was de-duplicated (array-level helpers + a single
  per-kind defaults table).
- **Callout leader line** anchors to the box edge (stays attached when text
  wraps).
- **Reachability** collapses a wide world-open range to one note; **autofix**
  deep-copies annotations on clone; **share links** guard payload size and fall
  back to JSON export; the **DSL** round-trips the lossless `raw` IaC carrier.

## Active follow-ups / known limitations

Small, non-blocking polish left for later:

- **Callout → node edge.** The leader line now starts at the callout's box edge;
  it could also stop at the target node's edge (rather than its centre) — needs
  node-rect plumbing into the overlay. _(S)_

## Near-term ideas (no backend required)

- **Reachability report panel** — the engine + overlay ship; a dedicated findings
  panel (exposed nodes, open ports, "what reaches the internet") is a natural next
  surface. _(S–M)_
- **More Well-Architected checks** grouped by pillar (tagging/governance,
  centralized logging, backup coverage). _(M, incremental)_
- **Advanced cost optimization** — region-aware/usage-based pricing, rightsizing &
  idle recommendations, reserved/savings-plan awareness. Demand is being gauged via
  the "coming soon" interest capture before building. _(M–L)_

## Deferred by design — needs a backend / infra

Out of scope until a durable persistence/auth tier exists:

- **Durable storage + accounts + "my diagrams"**, and short share-links
  (`/d/<slug>`) replacing the URL hash. _(M)_
- **Real-time collaboration** (multi-cursor / CRDT over the resource graph). _(XL)_
- **AI token-cost / LLM-workflow monitor** (cost per feature/customer, prompt
  history, model substitution) — requires a network proxy between the app and the
  model providers plus a metrics datastore and auth. Strata's in-scope adjacent
  slice today is the **change receipt** + **cost-diff** (cost discipline for
  _infrastructure_, not LLM tokens). _(XL)_
- **Remote Terraform / OpenTofu state reads** (S3 / GCS / azurerm / Terraform
  Cloud) — needs credentials and network egress. Local uploaded/pasted state is
  already supported. _(M–L)_
