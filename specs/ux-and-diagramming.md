# AWS Flow Builder — UX & Diagramming Direction

> Status: **proposal / direction** (not yet implemented). Owl-mode audit of the
> current experience, the hidden constraints, a refined UX model, and a phased
> implementation plan. Grounded in the current code (file/line references).

---

## 1. Audit — how the canvas behaves today

The canvas is an infinite, transform-based plane: `.world` and `svg.edges` are
absolutely positioned and moved with `translate(pan.x,pan.y) scale(pan.scale)`
(`useCanvasRenderer`). Nodes are absolutely-positioned `<div>` cards rebuilt via
a diff/patch reconciler; edges are SVG bezier curves.

| Capability | Today |
|---|---|
| Pan | Space+drag or middle-mouse drag (`useCanvasInteraction`) |
| Zoom | Wheel → multiplicative 0.9/1.1, **clamped 0.4–2.0**, **around world origin, not the cursor** (`onWheelZoom`, lines 128-130) |
| Snap | Drag/add round to **4px** (`Math.round(nx/4)*4`); visible grid is **16px / 80px** — mismatched |
| Minimap | Renders node rectangles only — **no viewport rectangle, no click/drag to navigate** |
| Fit / center | `fitToView` (bbox, clamp 0.4–1.6) and `center` exist |
| Multi-select | **None** (single selection only) |
| Alignment guides | **None** |
| Containment | `parentId` in the model + `groupIntoVPC` drops an overlapping box, but **children are not nested, do not move/resize/clip with the parent** |
| Layers / filters / view modes | **None** |
| Relationship encoding | All edges render the same cyan bezier; `kind` shown as a tiny always-on text label |
| Search on canvas | Palette has search; **no find-and-jump for placed nodes** |
| Save / Load | "Load from Server" uses a **`window.prompt` asking the user to type a number** from a text list (`loadFromServer`, useFlow.tsx:411-428) — should be a **dropdown/menu** of saved graphs (name + resource count + updated-at) |
| Node size | Single fixed size (`DEFAULT_NODE_SIZE` 240×100); **no density/LOD** |
| Layout chrome | Fixed 3-column grid `280px / 1fr / 360px` — ~44% of a 1440px laptop is side chrome |
| Imports (IaC/MCP) | Lay nodes out on a **flat grid**; derived `parentId` is **not** used for nesting |

### Per-persona read
- **First-time user:** opens to a blank dark canvas, no empty-state guidance, no template. Wheel zooms (not pans) around a corner, so the first scroll is disorienting.
- **Cloud engineer:** can place/connect but can't organize at scale — no multi-select, no align/distribute, no real grouping, narrow zoom, no filters to isolate a concern.
- **Non-technical stakeholder:** sees raw node/edge detail with no high-level/collapsed view, no presentation mode, no legend-driven simplification.
- **Future MCP/IaC user:** imports produce a flat grid of hundreds of full-detail cards with a straight-line edge hairball — the exact "black box" the product set out to dissolve.

---

## 2. Gaps, friction & scalability — including the non-obvious

**High-impact, low-effort**
1. **Zoom is not cursor-anchored.** The thing under the pointer should stay put on zoom; today it drifts toward the origin. Single biggest "feels broken" issue.
2. **Wheel semantics are inverted from pro tools.** Pros expect wheel = pan, ⌘/Ctrl+wheel or pinch = zoom. Today wheel always zooms; a trackpad two-finger scroll zooms unexpectedly.
3. **Narrow zoom range (0.4–2.0).** Useless for a 500-node account (needs ~0.05 overview) or fine detail (needs ~3×).
4. **Snap (4px) ≠ visible grid (16/80px); no alignment guides.** Nodes look "almost aligned," never crisp.
5. **Minimap is decorative.** No viewport indicator, no click-to-jump — so no quick navigation.

**Structural / architectural (the hard ones)**
6. **Containment is modeled but not rendered.** Real nesting (VPC▸subnet▸resource, account▸region▸service) needs container nodes that auto-fit children, children that move/clip with the parent, collapse/expand, and drag-in/out reparenting. This is a model+layout+interaction change, not CSS.
7. **Three organizing axes conflict: spatial (x/y) vs hierarchical (parentId) vs logical (edges).** Free-form position + containment + relationships create contradictory constraints (a child dragged outside its box; an edge crossing a boundary). **Resolution:** containers **auto-layout their children**; the user arranges *containers*, children pack automatically. Free placement at the top level only.
8. **The DOM-card substrate caps scale.** Even diff/patched, ~hundreds of `<div>` cards is the ceiling; MCP/IaC imports reach thousands. True overview needs **semantic LOD** (far zoom → icon/dot/summary, not a full card) and likely a canvas/WebGL or culled-SVG overview tier. You cannot bolt "show my whole account" onto full cards.
9. **Relationships are visually undifferentiated.** `depends_on`, `routes_to`, `allows`, data flow, containment all look identical. Legibility needs **relationship classes** (network / data / dependency / permission / containment) with distinct color + dash + arrowhead, and the ability to **toggle each as a layer**.
10. **No projections/view-modes.** Security, network, data-flow, and stakeholder views are **filters over one model**, not separate diagrams. Without a layer/filter engine, every audience sees the same noise.
11. **No overview↔detail scaffolding.** No focus/isolate, no breadcrumb (account▸region▸VPC), no zoom-to-selection, no minimap nav. Users get lost.
12. **History clones the whole graph per action** (`structuredClone` snapshots). At 2k nodes that is MBs per undo step — a memory/perf cliff.
13. **Visual-encoding budget will overflow.** Category already owns accent color. Adding environment, account, security-boundary, and relationship-class encodings to the same channel (color) causes ambiguity. Channels must be allocated deliberately: **icon=service, accent=category, background tint=environment/account, edge color=relationship-class, ring=selection/validation.**
14. **Edge routing is naive.** Straight beziers overlap into a hairball at scale; legibility needs orthogonal routing / bundling and on-hover focus (dim unrelated).
15. **Clutter at the source.** 101 palette services + thousands of importable nodes = default noise. Needs collapsed-by-default containers, LOD, leaf-summarization ("12× Lambda"), and on-canvas search.
16. **Fixed wide chrome wastes canvas.** Collapsible panels + a ⌘K command palette would reclaim ~40% of the screen.

---

## 3. Refined UX model (proposal)

### Canvas & scaling
- Keep the infinite transform plane. **Widen zoom to ~0.05–4×.** **Cursor-anchored** zoom. **Wheel = pan; ⌘/Ctrl+wheel & pinch = zoom.** Add zoom controls (+ / − / Fit / 100% / Zoom-to-selection).
- **Semantic LOD (3 tiers):** *far* = colored dot/icon or container summary; *mid* = icon + name + 1 key pill; *near* = full card. Driven by effective scale.
- **Minimap upgrade:** draw the viewport rectangle; click/drag to navigate.

### Nodes
- **Denser by default.** Compact card (~160×44: icon + name + category accent); full detail only near-zoom, on hover, or when selected. **Density toggle** (Comfortable / Compact).
- **Node states:** normal · selected (ring) · validation-error (red ring) · dimmed (filtered/out-of-focus) · search-match (highlight).

### Nesting / containment
- **Container nodes** (account, region, VPC, subnet, ECS/EKS cluster) that **auto-size to fit children** with a header + child-count badge.
- **Children auto-layout** inside the container (row/grid pack) — dropping a resource into a VPC "just works"; moving the container moves children; resize is automatic.
- **Collapse/expand** (collapsed = header + count + summarized ports). **Drag-in/out reparents.** **Breadcrumb** of the focus path; **Focus** a container = zoom-to-fit + dim siblings.
- **Hierarchy:** Account ▸ Region ▸ VPC ▸ Subnet ▸ Resource, plus non-spatial groupings (e.g. by environment/tag).
- **Wire IaC/MCP imports to nest** via the already-derived `parentId`.

### Layers / filters / view modes
- A **layer engine** over the single model: (a) resource-category visibility, (b) relationship-class visibility (network/data/dependency/permission/containment), (c) **overlays** (IAM trust, security-group paths, environment tint, cost/heat).
- **View-mode presets** that set layer combos: *Network*, *Security*, *Data-flow*, *High-level (collapsed)*, *Stakeholder/presentation*. **Saveable custom views.**
- Filtered-out elements **dim** (preserve context) with an option to fully hide. Left "Layers" panel + filter chips.

### Relationships
- **Encode by class:** color + dash + arrowhead; optional animated dots for data flow. **Containment is nesting, not an edge.** Labels on hover/selection only.
- **Focus mode:** hover/select a node → highlight its 1-hop (and n-hop "trace") neighborhood, dim the rest.
- **Edge routing:** orthogonal option + bundling at scale.

### Navigation & organization
- **⌘K command palette** (add service, run view, jump to node, import…). **On-canvas search** (name/type/ARN → highlight + center).
- **Multi-select** (marquee) + group move; **align/distribute**; **snap to visible grid** + dynamic alignment guides; arrow-key nudge; `[`/`]` collapse/expand; `F` focus.
- **Open/Load as a menu, not a prompt.** Replace the `window.prompt`-based "Load from Server" with a **dropdown/menu** listing saved graphs (name · resource count · last-updated), plus New / Duplicate / Delete / Rename. (Same menu can later host import options: Import JSON / Import IaC / Connect MCP.)

### Clutter & scale defenses
- LOD + collapsed-by-default large imports + **leaf summarization** + one-click **auto-layout (ELK/dagre) "Tidy"** (and layout-within-container).

---

## 4. Phased implementation plan

- **Phase 0 — Interaction polish (low risk, high impact).** Cursor-anchored zoom; wheel=pan / ⌘-wheel+pinch=zoom; widen zoom range; zoom controls + zoom-to-selection; minimap viewport rect + click-nav; snap-to-visible-grid + alignment guides; marquee multi-select + group move. **Quick wins also here:** replace the prompt-based Load with a graph **dropdown/menu**; empty-state hint on a blank canvas.
- **Phase 1 — Density & LOD.** Compact node design + density toggle; semantic LOD tiers; hover/selection focus-dimming.
- **Phase 2 — Nesting/containment.** Container nodes (auto-fit), child auto-layout, drag-in/out reparent, collapse/expand, breadcrumbs, focus-container; nest IaC/MCP imports via `parentId`. *(Largest; needs a layout engine.)*
- **Phase 3 — Layers / filters / views.** Layer engine, relationship-class encoding, view-mode presets, saved views, filter panel; IAM/SG/environment overlays.
- **Phase 4 — Scale.** Rendering-substrate decision (canvas/WebGL or culled SVG for overview); auto-layout "Tidy"; leaf summarization; edge routing/bundling; patch-based history.
- **Phase 5 — Navigation & onboarding.** ⌘K palette, on-canvas search, templates, empty state, presentation/read-only mode, accessibility pass.

**Sequencing note:** Phases 0–1 make today's tool *feel* production-grade within the current substrate. Phase 4's substrate decision is the gate for genuine cloud-topology scale (thousands of nodes); Phases 2–3 assume hundreds and should be built so they survive the substrate swap (keep layout/render logic behind the existing `draw()` seam).

---

## 5. Documentation direction (Nextra + cohesive deploy)

Today docs are a **separate Docusaurus site** (`website/`, React 19, its own build/deploy). Target: **Nextra**, with product + docs **deployed together as one cohesive experience**, and `ARCHITECTURE.md` migrated into the docs system.

**Integration fork (decision required):**
- **A — Embed Nextra in the same Next.js app** (docs at `/docs`, product at `/`). One build, one deploy — most cohesive. Cost: App Router layout segmentation (a `(docs)` route group with Nextra's theme vs the product's root layout) and global-CSS isolation.
- **B — Monorepo, two Next apps** (web + Nextra docs) stitched via Vercel rewrites (`/docs/*` → docs app). Cleaner separation, "together" via routing; two builds.
- **C — Standalone Nextra site** replacing Docusaurus, deployed separately. Simplest migration, least cohesive.

**Recommendation:** **A** if we accept the layout-segmentation work (best matches "one cohesive experience"); fall back to **B** if isolation proves painful. Either way: port `ARCHITECTURE.md` + `website/docs/*.md` + this `UX.md` into Nextra MDX, retire Docusaurus, and add the UX direction as a docs section.

---

## 6. Foundation check

The data model already supports this direction: `ResourceInstance.parentId` (containment), typed `Relationship.kind` (relationship classes), `Account`/region placement, and `source` (manual/imported/mcp). The work is in the **view layer** — rendering substrate, LOD, nesting layout, and a layer/filter engine — built behind the stable `draw()` seam so it can scale without reworking the model.
