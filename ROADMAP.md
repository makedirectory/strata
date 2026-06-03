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

## Active follow-ups / known limitations

Surfaced during review and intentionally left for a follow-up (none block normal
use):

- **Annotations — rendering depth.** The annotation layer is a separate DOM
  overlay with its own world→screen math and drag handling, parallel to the node
  renderer. Unify on a shared `worldToScreen` helper and one interaction layer so
  hit-testing, snapping, and resize stay consistent. _(M)_
- **Callout leader line.** Anchors to the callout's nominal box centre, so the
  line can detach from the visible bubble when text wraps to multiple lines.
  Measure the rendered height (or anchor to the box edge). _(S)_
- **Reachability — wide-range notes.** A single very wide world-open port range
  (e.g. `0-65535`) emits one note per sensitive port; collapse to a single
  "wide world-open range" note. _(S)_
- **Autofix — annotation cloning.** The autofix graph clone copies the
  `annotations` array by reference (safe today because the annotation helpers are
  immutable). Deep-copy it if any in-place annotation mutation is ever added. _(S)_
- **Share links — size budget.** The URL-hash share payload (now including
  annotations) has no length guard; large diagrams can silently exceed browser
  URL limits. Add a size check + warning, or fall back to JSON export. _(S)_
- **DSL — `raw` carrier.** Round-trips positions and config but not the lossless
  `raw` IaC source sidecar; a DSL round-trip degrades IaC re-export to a scaffold.
  _(M)_

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
