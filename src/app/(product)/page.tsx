"use client";
import React from "react";
import { FlowProvider, useFlow } from "../../hooks/useFlow";
import { Palette } from "../../components/Palette";
import { Canvas } from "../../components/Canvas";
import { Inspector } from "../../components/Inspector";
import { ReviewPanel } from "../../components/ReviewPanel";
import { MigratePanel } from "../../components/MigratePanel";
import { CommandPalette } from "../../components/CommandPalette";
import { collectTagKeys } from "../../aws/tags";
import { CATEGORIES, CATEGORY_ORDER } from "../../aws/categories";
import { RELATIONSHIP_CLASSES, RELATIONSHIP_CLASS_ORDER } from "../../aws/relationshipClasses";
import type { GraphSummary } from "../../aws/model";
import { exportIaC, type ExportFormat } from "../../aws/iacExport";
import { formatMonthly } from "../../aws/cost";
import { listDiscoverableTypes, parsePastedExport } from "../../aws/discovery";
import { listGcpDiscoverableTypes, parseGcpExport } from "../../gcp/discovery";
import { listAzureDiscoverableTypes, parseAzureExport } from "../../azure/discovery";
import { mapDiscoveredToGraph, unmappedTypes, type DiscoveredResource } from "../../aws/mcp";
import type { CloudProvider } from "../../aws/types";
import {
  runDiscovery,
  runGcpDiscovery,
  runAzureDiscovery,
  detectRepoRoots,
  connectRepo,
  runPlan,
  listSnapshots as listStoreSnapshots,
  saveSnapshot as saveStoreSnapshot,
  loadSnapshot as loadStoreSnapshot,
  type RepoRoot,
  type RepoRootReport,
  type SnapshotMeta as StoreSnapshotMeta,
} from "../../lib/api";
import type { PlanDiff } from "../../aws/planDiff";
import { EXAMPLES } from "../../examples";
import { CostComingSoon } from "../../components/ComingSoon";
import { useDialogA11y } from "../../components/useDialogA11y";
import { listSnapshots, deleteSnapshot, type SnapshotMeta } from "../../lib/snapshots";

/** Built-in coded starter templates (loadPreset ids) shown in the Start hub. */
const TEMPLATES: { id: string; label: string; icon: string; desc: string }[] = [
  { id: "aws-basic", label: "Basic AWS VPC", icon: "🧩", desc: "VPC + public/private subnets" },
  { id: "ecs-alb", label: "ECS behind an ALB", icon: "🚀", desc: "ALB → ECS, NAT, route tables" },
  {
    id: "serverless-api",
    label: "Serverless API",
    icon: "⚡",
    desc: "API GW → Lambda, DynamoDB, SQS",
  },
  { id: "static-website", label: "Static Website", icon: "🌐", desc: "Route 53 → CloudFront → S3" },
];

const VIEW_PRESETS = [
  { id: "all", label: "All" },
  { id: "network", label: "Network" },
  { id: "security", label: "Security" },
  { id: "data", label: "Data flow" },
  { id: "high-level", label: "High-level" },
] as const;

/** Layers / filters / view-modes panel (Phase 3). */
function LayersPanel() {
  const {
    hiddenCategories,
    hiddenRelClasses,
    toggleCategory,
    toggleRelClass,
    filterMode,
    setFilterMode,
    environmentTint,
    setEnvironmentTint,
    edgeStyle,
    setEdgeStyle,
    activeOverlay,
    setActiveOverlay,
    setTagTintKey,
    snapshotGraph,
    applyViewPreset,
    savedViews,
    saveView,
    applySavedView,
    deleteSavedView,
  } = useFlow();
  const [viewName, setViewName] = React.useState("");
  const commitSave = () => {
    if (viewName.trim()) {
      saveView(viewName);
      setViewName("");
    }
  };
  return (
    <div className="layers">
      <div className="layers-presets">
        {VIEW_PRESETS.map((p) => (
          <button key={p.id} onClick={() => applyViewPreset(p.id)} title={`${p.label} view`}>
            {p.label}
          </button>
        ))}
      </div>

      <div className="layers-sub">Relationships</div>
      <div className="chips">
        {RELATIONSHIP_CLASS_ORDER.map((c) => {
          const def = RELATIONSHIP_CLASSES[c];
          const on = !hiddenRelClasses.has(c);
          return (
            <button
              key={c}
              className={`chip ${on ? "on" : "off"}`}
              onClick={() => toggleRelClass(c)}
              aria-pressed={on}
            >
              <span className="chip-dot" style={{ background: def.color }} />
              {def.label}
            </button>
          );
        })}
      </div>

      <div className="layers-sub">Categories</div>
      <div className="chips chips-icons">
        {CATEGORY_ORDER.map((id) => {
          const on = !hiddenCategories.has(id);
          return (
            <button
              key={id}
              className={`chip chip-icon ${on ? "on" : "off"}`}
              onClick={() => toggleCategory(id)}
              title={CATEGORIES[id].name}
              aria-pressed={on}
              aria-label={CATEGORIES[id].name}
            >
              <span className="chip-dot" style={{ background: CATEGORIES[id].color }} />
              <span aria-hidden="true">{CATEGORIES[id].icon}</span>
            </button>
          );
        })}
      </div>

      <div className="layers-row">
        <span className="layers-sub">Filtered</span>
        <div className="seg">
          <button
            className={filterMode === "dim" ? "active" : ""}
            onClick={() => setFilterMode("dim")}
          >
            Dim
          </button>
          <button
            className={filterMode === "hide" ? "active" : ""}
            onClick={() => setFilterMode("hide")}
          >
            Hide
          </button>
        </div>
      </div>

      <div className="layers-row">
        <span className="layers-sub">Edges</span>
        <div className="seg">
          <button
            className={edgeStyle === "curved" ? "active" : ""}
            onClick={() => setEdgeStyle("curved")}
          >
            Curved
          </button>
          <button
            className={edgeStyle === "orthogonal" ? "active" : ""}
            onClick={() => setEdgeStyle("orthogonal")}
          >
            Orthogonal
          </button>
        </div>
      </div>

      <label className="layers-check">
        <input
          type="checkbox"
          checked={environmentTint}
          onChange={(e) => setEnvironmentTint(e.target.checked)}
        />
        Environment tint
      </label>

      <div className="layers-sub">Overlay</div>
      <div className="chips">
        {(
          [
            { id: "none", label: "None" },
            { id: "iam", label: "IAM trust" },
            { id: "security", label: "Network paths" },
            { id: "heat", label: "Heat (degree)" },
            { id: "reachability", label: "Reachability" },
            { id: "tags", label: "Tags" },
          ] as const
        ).map((o) => (
          <button
            key={o.id}
            className={`chip ${activeOverlay === o.id ? "on" : "off"}`}
            onClick={() => {
              if (o.id === "tags") {
                const keys = collectTagKeys(snapshotGraph());
                if (keys.length === 0) return;
                setTagTintKey(keys[0]);
              }
              setActiveOverlay(o.id);
            }}
            aria-pressed={activeOverlay === o.id}
          >
            {o.label}
          </button>
        ))}
      </div>
      <div className="help" style={{ margin: "0 2px" }}>
        Overlays trace the relationship graph (select a node to trace from it). Heat is a degree
        proxy.
      </div>
      {activeOverlay === "security" && (
        <div className="overlay-legend" aria-label="Network paths legend">
          <span className="overlay-legend-item">
            <span className="legend-line legend-line--internal" aria-hidden="true" />
            Internal
          </span>
          <span className="overlay-legend-item">
            <span className="legend-line legend-line--external" aria-hidden="true" />
            External (internet-facing)
          </span>
        </div>
      )}

      <div className="layers-sub">Saved views</div>
      <div className="saved-add">
        <input
          value={viewName}
          onChange={(e) => setViewName(e.target.value)}
          placeholder="Save current as…"
          onKeyDown={(e) => {
            if (e.key === "Enter") commitSave();
          }}
        />
        <button onClick={commitSave}>Save</button>
      </div>
      {savedViews.map((v) => (
        <div className="saved-view" key={v.name}>
          <button className="saved-apply" onClick={() => applySavedView(v.name)}>
            {v.name}
          </button>
          <button
            className="saved-del"
            title="Delete view"
            aria-label={`Delete ${v.name}`}
            onClick={() => deleteSavedView(v.name)}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

/** Lets a menu item close its parent menu after running. */
const MenuContext = React.createContext<{ close: () => void } | null>(null);

interface MenuProps {
  /** Trigger button content (e.g. "File ▾" or an icon). */
  label: React.ReactNode;
  title?: string;
  ariaLabel?: string;
  /** Which edge the dropdown aligns to. */
  align?: "left" | "right";
  /** Extra class on the trigger button (e.g. "icon-btn"). */
  triggerClassName?: string;
  /** Run when the menu opens — e.g. to (re)load async content. */
  onOpen?: () => void | Promise<void>;
  /** Static items, or a render-prop receiving `close` for dynamic content. */
  children: React.ReactNode | ((close: () => void) => React.ReactNode);
}

/** Generalized dropdown menu: trigger button + panel, with click-outside and
 *  Esc to close. Extracted from the old LoadMenu so the toolbar's Data / Analyze
 *  menus and LoadMenu all share one accessible implementation. */
function Menu({
  label,
  title,
  ariaLabel,
  align = "right",
  triggerClassName,
  onOpen,
  children,
}: MenuProps) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  const close = React.useCallback(() => setOpen(false), []);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && onOpen) await onOpen();
  };

  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="menu" ref={ref}>
      <button
        type="button"
        className={triggerClassName}
        onClick={toggle}
        title={title}
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {label}
      </button>
      {open && (
        <div className={`menu-dropdown menu-dropdown--${align}`} role="menu">
          <MenuContext.Provider value={{ close }}>
            {typeof children === "function" ? children(close) : children}
          </MenuContext.Provider>
        </div>
      )}
    </div>
  );
}

interface MenuItemProps {
  onClick?: () => void;
  children: React.ReactNode;
  title?: string;
  disabled?: boolean;
  /** Style as a destructive action. */
  danger?: boolean;
  /** Trailing badge text, e.g. "Coming soon". */
  badge?: string;
  /** Keep the menu open after clicking (default closes it). */
  keepOpen?: boolean;
}

function MenuItem({ onClick, children, title, disabled, danger, badge, keepOpen }: MenuItemProps) {
  const ctx = React.useContext(MenuContext);
  return (
    <button
      type="button"
      role="menuitem"
      className={`menu-item${danger ? " menu-item--danger" : ""}`}
      title={title}
      disabled={disabled}
      onClick={() => {
        if (disabled) return;
        onClick?.();
        if (!keepOpen) ctx?.close();
      }}
    >
      <span className="menu-item-label">{children}</span>
      {badge && <span className="menu-item-badge">{badge}</span>}
    </button>
  );
}

/** Dropdown listing saved graphs (name · resource count · updated). Built on the
 *  shared Menu primitive; fetches the list each time it opens. */
function LoadMenu() {
  const { listSavedGraphs, loadGraph, deleteSavedGraph } = useFlow();
  const [graphs, setGraphs] = React.useState<GraphSummary[] | null>(null);

  const refresh = React.useCallback(async () => {
    setGraphs(null);
    setGraphs(await listSavedGraphs());
  }, [listSavedGraphs]);

  return (
    <Menu
      label="Open ▾"
      title="Open a diagram saved in this browser"
      align="right"
      onOpen={refresh}
    >
      {(close) => (
        <>
          {graphs === null && <div className="menu-empty">Loading…</div>}
          {graphs && graphs.length === 0 && <div className="menu-empty">No saved graphs.</div>}
          {graphs?.map((g) => (
            <div className="menu-row" key={g.id}>
              <button
                className="menu-pick"
                role="menuitem"
                onClick={async () => {
                  close();
                  await loadGraph(g.id);
                }}
              >
                <span className="menu-pick-name">{g.name}</span>
                <span className="menu-pick-meta">
                  {g.resourceCount} resource{g.resourceCount === 1 ? "" : "s"}
                  {g.updatedAt ? ` · ${new Date(g.updatedAt).toLocaleDateString()}` : ""}
                </span>
              </button>
              <button
                className="menu-delete"
                title="Delete saved graph"
                aria-label={`Delete ${g.name}`}
                onClick={async () => {
                  await deleteSavedGraph(g.id);
                  await refresh();
                }}
              >
                ✕
              </button>
            </div>
          ))}
        </>
      )}
    </Menu>
  );
}

function TopBar() {
  const {
    runValidateUI,
    runRulesUI,
    exportJSON,
    exportImage,
    shareDiagram,
    openCompare,
    openVersions,
    importJSONDialog,
    importIaCDialog,
    clear,
    status,
    undo,
    redo,
    canUndo,
    canRedo,
    saveGraph,
    setPresentation,
    openStartHub,
    openExportIaC,
    openConnect,
    openCompanion,
    graphName,
    renameGraph,
    openTour,
    showCost,
    toggleCost,
    costSummary,
  } = useFlow();
  return (
    <div className="topbar">
      <div className="logo">
        <span role="img" aria-label="Strata logo">
          🔶
        </span>{" "}
        <span style={{ fontWeight: 800 }}>Strata</span>
      </div>
      <input
        className="diagram-name"
        value={graphName}
        onChange={(e) => renameGraph(e.target.value)}
        onBlur={(e) => {
          if (!e.target.value.trim()) renameGraph("Untitled diagram");
        }}
        title="Diagram name — used when you save"
        aria-label="Diagram name"
        spellCheck={false}
      />
      <a
        className="topbar-link"
        href="/docs"
        target="_blank"
        rel="noreferrer"
        title="Open the documentation (User Guide & Architecture) in a new tab"
      >
        Docs ↗
      </a>
      <button className="topbar-link topbar-tour" onClick={openTour} title="Show the quick tour">
        Intro
      </button>
      <div className="status" id="status">
        {status}
      </div>
      <div className="toolbar">
        <button className="btn-start" onClick={openStartHub} title="Start a new diagram">
          + New
        </button>

        <span className="toolbar-divider" aria-hidden="true" />

        {/* Edit-state controls — compact icon buttons. */}
        <button
          className="icon-btn"
          onClick={undo}
          disabled={!canUndo}
          title="Undo (⌘Z / Ctrl+Z)"
          aria-label="Undo"
        >
          ↶
        </button>
        <button
          className="icon-btn"
          onClick={redo}
          disabled={!canRedo}
          title="Redo (⇧⌘Z / Ctrl+Y)"
          aria-label="Redo"
        >
          ↷
        </button>

        <span className="toolbar-divider" aria-hidden="true" />

        {/* Save + Open persist diagrams in this browser (localStorage). */}
        <button
          className="icon-btn"
          onClick={saveGraph}
          title="Save diagram to this browser"
          aria-label="Save diagram"
        >
          💾
        </button>
        <LoadMenu />

        <span className="toolbar-divider" aria-hidden="true" />

        {/* Data: bring infrastructure in (connect / import), send it out (export),
            or clear. (⌘K palette remains the full index.) */}
        <Menu label="Data ▾" title="Connect, import, export, and clear" align="right">
          <MenuItem
            onClick={openConnect}
            title="Discover live AWS, GCP or Azure resources, or paste an export"
          >
            Connect to cloud…
          </MenuItem>
          <MenuItem
            onClick={openCompanion}
            title="Map a local Terraform / OpenTofu repo and visualize a plan diff"
          >
            Terraform companion…
          </MenuItem>
          <MenuItem onClick={importJSONDialog}>Import JSON…</MenuItem>
          <MenuItem
            onClick={importIaCDialog}
            title="Import Terraform / OpenTofu (AWS/GCP/Azure), CloudFormation, or an Azure ARM template"
          >
            Import IaC (Terraform / OpenTofu / CloudFormation / ARM)…
          </MenuItem>
          <div className="menu-divider" />
          <MenuItem onClick={exportJSON}>Export JSON</MenuItem>
          <MenuItem onClick={() => exportImage("png")} title="Download the diagram as a PNG image">
            Export PNG image
          </MenuItem>
          <MenuItem onClick={() => exportImage("svg")} title="Download the diagram as an SVG image">
            Export SVG image
          </MenuItem>
          <MenuItem
            onClick={shareDiagram}
            title="Copy a self-contained share link to the clipboard"
          >
            Copy share link
          </MenuItem>
          <MenuItem
            onClick={openExportIaC}
            title="Generate Terraform / CloudFormation from the diagram"
          >
            Export to IaC…
          </MenuItem>
          <div className="menu-divider" />
          <MenuItem
            onClick={openCompare}
            title="Compare this diagram against a baseline (a saved diagram, a live export, IaC, or Strata JSON)"
          >
            Compare for drift…
          </MenuItem>
          <MenuItem
            onClick={openVersions}
            title="Local version history — snapshot, restore, or compare against a saved version"
          >
            Version history…
          </MenuItem>
          <div className="menu-divider" />
          <MenuItem onClick={clear} danger title="Clear the canvas">
            Clear canvas
          </MenuItem>
        </Menu>

        {/* Analyze: the differentiating checks, grouped together. */}
        <Menu label="Analyze ▾" title="Validate and suggest rules" align="right">
          <MenuItem onClick={runValidateUI} title="Check architecture for issues">
            Validate architecture
          </MenuItem>
          <MenuItem onClick={runRulesUI} title="Suggest rules for SG / NACL / Routes">
            Suggest rules
          </MenuItem>
        </Menu>

        <button
          className={showCost ? "toolbar-toggle active" : "toolbar-toggle"}
          onClick={toggleCost}
          title="Toggle estimated monthly cost (rough)"
          aria-pressed={showCost}
        >
          {showCost ? `Cost ~${costSummary.label}` : "Cost"}
        </button>
        <CostComingSoon />

        <span className="toolbar-divider" aria-hidden="true" />

        <button
          className="icon-btn"
          onClick={() => setPresentation(true)}
          title="Presentation / read-only mode"
          aria-label="Enter presentation mode"
        >
          ▶
        </button>
      </div>
    </div>
  );
}

function ModeButtons() {
  const { setMode, state } = useFlow();
  return (
    <div className="palette">
      <button onClick={() => setMode("move")} className={state.mode === "move" ? "active" : ""}>
        Move
      </button>
      <button
        onClick={() => setMode("connect")}
        className={state.mode === "connect" ? "active" : ""}
      >
        Connect
      </button>
    </div>
  );
}

function DensityButtons() {
  const { setDensity, state } = useFlow();
  return (
    <div className="palette">
      <button
        onClick={() => setDensity("comfortable")}
        className={state.density === "comfortable" ? "active" : ""}
      >
        Comfortable
      </button>
      <button
        onClick={() => setDensity("compact")}
        className={state.density === "compact" ? "active" : ""}
      >
        Compact
      </button>
    </div>
  );
}

function FooterControls() {
  const { fitToView, center, tidy } = useFlow();
  return (
    <div className="footer">
      <button onClick={fitToView}>Fit to View</button>
      <button onClick={center}>Center</button>
      <button onClick={tidy} title="Auto-arrange top-level nodes">
        Tidy
      </button>
    </div>
  );
}

/** Saved-graph list rendered inside the Start hub. Fetches on mount (the hub
 *  only mounts this when open). */
function HubSavedGraphs() {
  const { listSavedGraphs, loadGraph, closeStartHub } = useFlow();
  const [graphs, setGraphs] = React.useState<GraphSummary[] | null>(null);
  React.useEffect(() => {
    let alive = true;
    void (async () => {
      const list = await listSavedGraphs();
      if (alive) setGraphs(list);
    })();
    return () => {
      alive = false;
    };
  }, [listSavedGraphs]);

  if (graphs !== null && graphs.length === 0) return null;
  return (
    <div className="hub-saved">
      <div className="hub-saved-title">Open a saved diagram</div>
      {graphs === null ? (
        <div className="menu-empty">Loading…</div>
      ) : (
        <div className="hub-saved-list">
          {graphs.map((g) => (
            <button
              key={g.id}
              className="hub-saved-item"
              onClick={async () => {
                closeStartHub();
                await loadGraph(g.id);
              }}
            >
              <span className="hub-saved-name">{g.name}</span>
              <span className="hub-saved-meta">
                {g.resourceCount} resource{g.resourceCount === 1 ? "" : "s"}
                {g.updatedAt ? ` · ${new Date(g.updatedAt).toLocaleDateString()}` : ""}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Always-on validation summary: a corner chip with live error/warn counts that
 *  expands to a clickable findings list (click focuses the offending node). */
function ValidationBadge() {
  const { liveFindings, findingCounts, goToResource, presentation } = useFlow();
  const [open, setOpen] = React.useState(false);
  const { error, warn } = findingCounts;
  if (presentation || liveFindings.length === 0) return null;
  return (
    <div className={open ? "valbadge open" : "valbadge"}>
      <button
        className="valbadge-chip"
        onClick={() => setOpen((v) => !v)}
        title="Validation findings"
        aria-expanded={open}
      >
        {error > 0 && <span className="valbadge-count error">⛔ {error}</span>}
        {warn > 0 && <span className="valbadge-count warn">⚠ {warn}</span>}
        <span className="valbadge-label">{open ? "▾" : "▸"} findings</span>
      </button>
      {open && (
        <ul className="valbadge-list">
          {liveFindings.map((f, i) => (
            <li key={i} className={`valbadge-item ${f.level}`}>
              <button
                className="valbadge-item-btn"
                disabled={!f.resourceId}
                onClick={() => f.resourceId && goToResource(f.resourceId)}
                title={f.resourceId ? "Go to resource" : undefined}
              >
                <span className={`valbadge-dot ${f.level}`} aria-hidden="true" />
                {f.message}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Drift results: a dismissible panel summarising how the diagram differs from a
 *  loaded baseline (added / removed / changed). Added & changed nodes are also
 *  dotted on the canvas; removed resources (not on the canvas) are listed here. */
function DriftPanel() {
  const { driftResult, driftBaselineName, driftCost, clearDrift, goToResource } = useFlow();
  if (!driftResult) return null;
  const { added, removed, changed, unchanged, inSync } = driftResult;
  return (
    <div className="drift" role="region" aria-label="Drift results">
      <div className="drift-head">
        <strong>Drift vs {driftBaselineName || "baseline"}</strong>
        <button className="hub-close" onClick={clearDrift} aria-label="Close drift results">
          ✕
        </button>
      </div>
      {inSync ? (
        <div className="drift-insync">✓ In sync — no differences.</div>
      ) : (
        <div className="drift-counts">
          <span className="drift-c added">+{added.length} added</span>
          <span className="drift-c removed">−{removed.length} removed</span>
          <span className="drift-c changed">~{changed.length} changed</span>
          <span className="drift-c">{unchanged} in sync</span>
        </div>
      )}
      {driftCost && (
        <div className="drift-cost" title="Rough monthly estimate — this diagram vs the baseline">
          <span className="drift-cost-label">Est. cost</span>
          <span>
            {formatMonthly(driftCost.baseline)} → {formatMonthly(driftCost.current)}
          </span>
          <span
            className={
              driftCost.delta > 0
                ? "drift-cost-delta up"
                : driftCost.delta < 0
                  ? "drift-cost-delta down"
                  : "drift-cost-delta"
            }
          >
            {driftCost.delta === 0
              ? "no change"
              : `${driftCost.delta > 0 ? "▲ +" : "▼ −"}${formatMonthly(Math.abs(driftCost.delta))}`}
          </span>
        </div>
      )}
      <div className="drift-list">
        {added.map((r) => (
          <button key={`a-${r.id}`} className="drift-item added" onClick={() => goToResource(r.id)}>
            + {r.name} <span className="drift-svc">{r.serviceId}</span>
          </button>
        ))}
        {changed.map((r) => (
          <button
            key={`c-${r.id}`}
            className="drift-item changed"
            onClick={() => goToResource(r.id)}
          >
            ~ {r.name} <span className="drift-svc">{r.changes.map((c) => c.key).join(", ")}</span>
          </button>
        ))}
        {removed.map((r) => (
          <div key={`r-${r.id}`} className="drift-item removed">
            − {r.name} <span className="drift-svc">{r.serviceId}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Compare-for-drift picker: choose a baseline — one of this browser's saved
 *  diagrams, or a file (Strata JSON / IaC). Diffing itself is non-destructive. */
function CompareDialog() {
  const { compareOpen, closeCompare, compareWithFile, compareWithSaved, listSavedGraphs } =
    useFlow();
  const [saved, setSaved] = React.useState<GraphSummary[] | null>(null);
  const ref = useDialogA11y<HTMLDivElement>(compareOpen, closeCompare);

  React.useEffect(() => {
    if (!compareOpen) return;
    let live = true;
    setSaved(null);
    listSavedGraphs()
      .then((g) => live && setSaved(g))
      .catch(() => live && setSaved([]));
    return () => {
      live = false;
    };
  }, [compareOpen, listSavedGraphs]);

  if (!compareOpen) return null;
  return (
    <div className="hub-backdrop" onMouseDown={closeCompare}>
      <div
        className="export"
        role="dialog"
        aria-modal="true"
        aria-label="Compare for drift"
        ref={ref}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="hub-header">
          <h2 className="hub-title">Compare for drift</h2>
          <button className="hub-close" onClick={closeCompare} aria-label="Close">
            ✕
          </button>
        </div>
        <p className="hub-subtitle">
          Pick a <strong>baseline</strong> to compare the current diagram against. Nothing is
          changed — drifted resources are highlighted on the canvas with a summary.
        </p>

        <div className="compare-section">
          <div className="layers-sub">From a file</div>
          <button className="btn-start" onClick={compareWithFile}>
            Choose a file… (Strata JSON, CloudFormation, ARM, Terraform)
          </button>
        </div>

        <div className="compare-section">
          <div className="layers-sub">A saved diagram</div>
          {saved === null ? (
            <div className="help">Loading…</div>
          ) : saved.length === 0 ? (
            <div className="help">No saved diagrams in this browser yet.</div>
          ) : (
            <div className="compare-list">
              {saved.map((g) => (
                <button
                  key={g.id}
                  className="compare-item"
                  onClick={() => compareWithSaved(g.id)}
                  title={`Compare against "${g.name}"`}
                >
                  <span className="compare-item-name">{g.name}</span>
                  <span className="compare-item-meta">
                    {g.resourceCount} resource{g.resourceCount === 1 ? "" : "s"}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Local version history: snapshot the current diagram, list saved versions, and
 *  use any as a drift/cost baseline or restore it. Snapshots live in this
 *  browser (a bounded ring) — cross-device history needs the sharing backend. */
function VersionsDialog() {
  const { versionsOpen, closeVersions, saveVersion, restoreVersion, compareWithVersion } =
    useFlow();
  const ref = useDialogA11y<HTMLDivElement>(versionsOpen, closeVersions);
  const [versions, setVersions] = React.useState<SnapshotMeta[]>([]);
  const [label, setLabel] = React.useState("");
  const refresh = React.useCallback(() => setVersions(listSnapshots()), []);

  React.useEffect(() => {
    if (versionsOpen) {
      refresh();
      setLabel("");
    }
  }, [versionsOpen, refresh]);

  if (!versionsOpen) return null;
  const save = () => {
    saveVersion(label);
    setLabel("");
    refresh();
  };
  return (
    <div className="hub-backdrop" onMouseDown={closeVersions}>
      <div
        className="export"
        role="dialog"
        aria-modal="true"
        aria-label="Version history"
        ref={ref}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="hub-header">
          <h2 className="hub-title">Version history</h2>
          <button className="hub-close" onClick={closeVersions} aria-label="Close">
            ✕
          </button>
        </div>
        <p className="hub-subtitle">
          Snapshots saved in this browser. Use one as a drift/cost baseline, or restore it.
          Cross-device history needs the sharing backend.
        </p>

        <div className="compare-section">
          <div className="saved-add">
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Label this version (e.g. pre-migration)…"
              onKeyDown={(e) => {
                if (e.key === "Enter") save();
              }}
            />
            <button onClick={save}>Save version</button>
          </div>
        </div>

        <div className="compare-section">
          <div className="layers-sub">Saved versions</div>
          {versions.length === 0 ? (
            <div className="help">No versions yet — save one above.</div>
          ) : (
            <div className="compare-list">
              {versions.map((v) => (
                <div key={v.id} className="version-item">
                  <div className="version-meta">
                    <span className="compare-item-name">{v.label}</span>
                    <span className="compare-item-meta">
                      {v.resourceCount} resource{v.resourceCount === 1 ? "" : "s"} ·{" "}
                      {new Date(v.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <div className="version-actions">
                    <button
                      onClick={() => compareWithVersion(v.id, v.label)}
                      title="Compare the current diagram against this version"
                    >
                      Compare
                    </button>
                    <button
                      onClick={() => restoreVersion(v.id)}
                      title="Restore this version onto the canvas"
                    >
                      Restore
                    </button>
                    <button
                      className="saved-del"
                      aria-label={`Delete version ${v.label}`}
                      title="Delete this version"
                      onClick={() => {
                        deleteSnapshot(v.id);
                        refresh();
                      }}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Merge preview: before applying a discovered/imported merge, show what it will
 *  change — new resources to add and existing ones to update (with the fields
 *  that differ) — so the user can confirm or cancel. Reuses the drift diff. */
function MergePreviewDialog() {
  const { mergePreview, confirmMerge, cancelMerge } = useFlow();
  const ref = useDialogA11y<HTMLDivElement>(mergePreview !== null, cancelMerge);
  if (!mergePreview) return null;
  const { added, changed, unchanged, removed } = mergePreview;
  const nothing = added.length === 0 && changed.length === 0;
  return (
    <div className="hub-backdrop hub-backdrop--top" onMouseDown={cancelMerge}>
      <div
        className="export"
        role="dialog"
        aria-modal="true"
        aria-label="Review merge"
        ref={ref}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="hub-header">
          <h2 className="hub-title">Review merge</h2>
          <button className="hub-close" onClick={cancelMerge} aria-label="Cancel merge">
            ✕
          </button>
        </div>
        <p className="hub-subtitle">
          Merging reconciles into your diagram — matched resources are updated in place (keeping
          their position), new ones are added, and nothing is removed.
        </p>
        <div className="drift-counts">
          <span className="drift-c added">+{added.length} new</span>
          <span className="drift-c changed">~{changed.length} updated</span>
          <span className="drift-c">{unchanged} unchanged</span>
          <span className="drift-c">{removed.length} kept (not in source)</span>
        </div>
        <div className="drift-list" style={{ maxHeight: "40vh" }}>
          {nothing && <div className="help">Everything already matches — nothing to change.</div>}
          {added.map((r) => (
            <div key={`a-${r.id}`} className="drift-item added">
              + {r.name} <span className="drift-svc">{r.serviceId}</span>
            </div>
          ))}
          {changed.map((r) => (
            <div key={`c-${r.id}`} className="drift-item changed">
              ~ {r.name} <span className="drift-svc">{r.changes.map((c) => c.key).join(", ")}</span>
            </div>
          ))}
        </div>
        <div className="confirm-actions">
          <button className="btn-start" onClick={confirmMerge}>
            {nothing ? "Apply (no changes)" : "Apply merge"}
          </button>
          <button onClick={cancelMerge}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

/** Steps for the first-run guided tour. */
const TOUR_STEPS: { icon: string; title: string; body: React.ReactNode }[] = [
  {
    icon: "👋",
    title: "Welcome to Strata",
    body: "Design cloud architecture as a typed graph — across AWS, Google Cloud and Azure. Here's the 20-second tour.",
  },
  {
    icon: "🧱",
    title: "Add services",
    body: (
      <>
        Drag a service from the <strong>palette</strong> on the left onto the canvas. Drop it inside
        a container (like a VPC or Resource Group) to nest it — containers resize to fit.
      </>
    ),
  },
  {
    icon: "🔗",
    title: "Connect them",
    body: (
      <>
        Press <strong>C</strong> (or drag from a node&rsquo;s port) to draw typed relationships —{" "}
        <em>contains</em>, <em>routes&nbsp;to</em>, <em>invokes</em>, and more.
      </>
    ),
  },
  {
    icon: "⌨️",
    title: "Command palette",
    body: (
      <>
        Press <strong>⌘K</strong> (Ctrl+K) to search services, jump to any node, or run any command
        — the fastest way to get around.
      </>
    ),
  },
  {
    icon: "✨",
    title: "Organize, check & save",
    body: (
      <>
        Hit <strong>Tidy</strong> to auto-arrange, <strong>Validate</strong> for best-practice
        findings, then name your diagram in the top bar and <strong>Save</strong>.
      </>
    ),
  },
];

/** First-run guided tour — a short, dismissible intro shown once (and
 *  re-launchable from the top bar). The final step hands off to the Start hub. */
function Tour() {
  const { tourOpen, tourStep, closeTour, setTourStep, openStartHub } = useFlow();
  // Focus management, Tab-trap, Escape-to-close, and background inert.
  const tourRef = useDialogA11y<HTMLDivElement>(tourOpen, closeTour);
  // Arrow keys step the tour (Escape/Tab handled by useDialogA11y).
  React.useEffect(() => {
    if (!tourOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") setTourStep(Math.min(TOUR_STEPS.length - 1, tourStep + 1));
      if (e.key === "ArrowLeft") setTourStep(tourStep - 1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [tourOpen, tourStep, setTourStep]);

  if (!tourOpen) return null;
  const step = TOUR_STEPS[Math.min(tourStep, TOUR_STEPS.length - 1)];
  const isLast = tourStep >= TOUR_STEPS.length - 1;

  return (
    <div className="hub-backdrop hub-backdrop--top" onMouseDown={closeTour}>
      <div
        className="tour"
        role="dialog"
        aria-modal="true"
        aria-label="Getting started"
        ref={tourRef}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button className="hub-close" onClick={closeTour} aria-label="Close">
          ✕
        </button>
        <div className="tour-icon" aria-hidden="true">
          {step.icon}
        </div>
        <h2 className="tour-title">{step.title}</h2>
        <p className="tour-body">{step.body}</p>

        <div className="tour-dots" aria-hidden="true">
          {TOUR_STEPS.map((_, i) => (
            <span key={i} className={i === tourStep ? "tour-dot active" : "tour-dot"} />
          ))}
        </div>

        <div className="tour-nav">
          <button className="tour-skip" onClick={closeTour}>
            {isLast ? "Close" : "Skip"}
          </button>
          <div className="tour-nav-right">
            {tourStep > 0 && (
              <button className="tour-back" onClick={() => setTourStep(tourStep - 1)}>
                Back
              </button>
            )}
            {isLast ? (
              <button
                className="btn-start"
                onClick={() => {
                  closeTour();
                  openStartHub();
                }}
              >
                Browse examples
              </button>
            ) : (
              <button className="btn-start" onClick={() => setTourStep(tourStep + 1)}>
                Next
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** "Start a diagram" launcher — a hub of mutually-exclusive starting points,
 *  not a linear wizard. Real entries call the existing (guarded) handlers;
 *  unbuilt capabilities are shown disabled with a "Coming soon" badge. */
function StartHub() {
  const {
    startHubOpen,
    closeStartHub,
    startBlank,
    importIaCDialog,
    importJSONDialog,
    loadPreset,
    loadExample,
    openExportIaC,
    openConnect,
    state,
  } = useFlow();
  const dialogRef = useDialogA11y<HTMLDivElement>(startHubOpen, closeStartHub);

  if (!startHubOpen) return null;
  const hasGraph = state.resources.length > 0;

  return (
    <div className="hub-backdrop" onMouseDown={closeStartHub}>
      <div
        className="hub"
        role="dialog"
        aria-modal="true"
        aria-label="Start a diagram"
        ref={dialogRef}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="hub-header">
          <h2 className="hub-title">Start a diagram</h2>
          <button className="hub-close" onClick={closeStartHub} aria-label="Close">
            ✕
          </button>
        </div>
        <p className="hub-subtitle">
          New here? Open an <strong>example</strong> below to explore, start from a{" "}
          <strong>template</strong>, or build from scratch — you can drag services from the palette
          anytime.
        </p>

        <div className="hub-grid">
          <button className="hub-card" onClick={() => startBlank()}>
            <span className="hub-card-icon" aria-hidden="true">
              ✏️
            </span>
            <span className="hub-card-title">Start blank</span>
            <span className="hub-card-desc">Design from the palette on an empty canvas.</span>
          </button>

          <button
            className="hub-card"
            onClick={() => {
              closeStartHub();
              importIaCDialog();
            }}
          >
            <span className="hub-card-icon" aria-hidden="true">
              📦
            </span>
            <span className="hub-card-title">Import IaC</span>
            <span className="hub-card-desc">
              Terraform (AWS/GCP/Azure), CloudFormation, or an Azure ARM template. Maps known
              resource types into an editable diagram; unmapped types are listed after import.
            </span>
          </button>

          <button
            className="hub-card"
            onClick={() => {
              closeStartHub();
              importJSONDialog();
            }}
          >
            <span className="hub-card-icon" aria-hidden="true">
              🗂️
            </span>
            <span className="hub-card-title">Import Strata JSON</span>
            <span className="hub-card-desc">Open a diagram previously exported from Strata.</span>
          </button>

          <button
            className="hub-card"
            onClick={() => {
              closeStartHub();
              openConnect();
            }}
          >
            <span className="hub-card-icon" aria-hidden="true">
              ☁️
            </span>
            <span className="hub-card-title">Connect to cloud</span>
            <span className="hub-card-desc">
              Discover live AWS, GCP or Azure resources (or paste an export) and map them onto the
              canvas.
            </span>
          </button>

          {/* Export-to-IaC (Flow 3). Only meaningful with a graph. */}
          {hasGraph && (
            <button
              className="hub-card"
              onClick={() => {
                closeStartHub();
                openExportIaC();
              }}
            >
              <span className="hub-card-icon" aria-hidden="true">
                📤
              </span>
              <span className="hub-card-title">Export to IaC</span>
              <span className="hub-card-desc">
                Generate Terraform / CloudFormation from your diagram (a scaffold to finish).
              </span>
            </button>
          )}
        </div>

        <div className="hub-examples">
          <div className="hub-section-title">Templates</div>
          <div className="hub-examples-grid">
            {TEMPLATES.map((t) => (
              <button
                key={t.id}
                className="hub-example"
                onClick={() => {
                  closeStartHub();
                  void loadPreset(t.id);
                }}
                title={t.desc}
              >
                <span className="hub-example-icon" aria-hidden="true">
                  {t.icon}
                </span>
                <span className="hub-example-body">
                  <span className="hub-example-label">{t.label}</span>
                  <span className="hub-example-meta">{t.desc}</span>
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="hub-examples">
          <div className="hub-section-title">Examples</div>
          <div className="hub-examples-grid">
            {EXAMPLES.map((ex) => (
              <button
                key={ex.id}
                className="hub-example"
                onClick={() => void loadExample(ex.id)}
                title={ex.graph.description}
              >
                <span className="hub-example-icon" aria-hidden="true">
                  {ex.icon}
                </span>
                <span className="hub-example-body">
                  <span className="hub-example-label">{ex.label}</span>
                  <span className="hub-example-meta">{ex.graph.resources.length} resources</span>
                </span>
              </button>
            ))}
          </div>
        </div>

        <HubSavedGraphs />
      </div>
    </div>
  );
}

/** Confirmation shown before a replace action would discard unsaved work.
 *  Renders above the hub. */
function ReplaceConfirmDialog() {
  const { replaceConfirmOpen, resolveReplaceConfirm } = useFlow();
  const ref = useDialogA11y<HTMLDivElement>(replaceConfirmOpen, () =>
    resolveReplaceConfirm("cancel"),
  );

  if (!replaceConfirmOpen) return null;
  return (
    <div
      className="hub-backdrop hub-backdrop--top"
      onMouseDown={() => resolveReplaceConfirm("cancel")}
    >
      <div
        className="confirm"
        role="alertdialog"
        aria-modal="true"
        aria-label="Unsaved changes"
        ref={ref}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="confirm-title">Replace the current diagram?</div>
        <div className="confirm-msg">
          You have unsaved changes that will be lost. Save them first, or discard and continue.
        </div>
        <div className="confirm-actions">
          <button className="btn-start" onClick={() => resolveReplaceConfirm("save")}>
            Save &amp; continue
          </button>
          <button onClick={() => resolveReplaceConfirm("discard")}>Discard &amp; continue</button>
          <button onClick={() => resolveReplaceConfirm("cancel")}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

const EXPORT_FORMATS: { id: ExportFormat; label: string }[] = [
  { id: "cloudformation-yaml", label: "CloudFormation (YAML)" },
  { id: "cloudformation-json", label: "CloudFormation (JSON)" },
  { id: "terraform", label: "Terraform / OpenTofu (HCL)" },
];

/** Export-to-IaC dialog: pick a format, preview the scaffold, see the coverage
 *  report (the honesty surface), then copy or download. */
function ExportDialog() {
  const { exportIaCOpen, closeExportIaC, snapshotGraph } = useFlow();
  const [format, setFormat] = React.useState<ExportFormat>("cloudformation-yaml");
  const [copied, setCopied] = React.useState(false);
  const ref = useDialogA11y<HTMLDivElement>(exportIaCOpen, closeExportIaC);

  // Reset the "Copied" affordance whenever the dialog opens or the format changes.
  React.useEffect(() => {
    if (exportIaCOpen) setCopied(false);
  }, [exportIaCOpen, format]);

  // Recompute only while open and when the format changes.
  const result = React.useMemo(
    () => (exportIaCOpen ? exportIaC(snapshotGraph(), format) : null),
    [exportIaCOpen, format, snapshotGraph],
  );

  if (!exportIaCOpen || !result) return null;
  const { content, filename, report } = result;

  const download = () => {
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 0); // don't leak the object URL
  };
  const copy = () => {
    void navigator.clipboard?.writeText(content);
    setCopied(true);
  };

  return (
    <div className="hub-backdrop" onMouseDown={closeExportIaC}>
      <div
        className="export"
        role="dialog"
        aria-modal="true"
        aria-label="Export to IaC"
        ref={ref}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="hub-header">
          <h2 className="hub-title">Export to IaC</h2>
          <button className="hub-close" onClick={closeExportIaC} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="export-controls">
          <label className="export-field">
            <span>Format</span>
            <select value={format} onChange={(e) => setFormat(e.target.value as ExportFormat)}>
              {EXPORT_FORMATS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
          <div className="export-actions">
            <button onClick={copy}>{copied ? "Copied ✓" : "Copy"}</button>
            <button className="btn-start" onClick={download}>
              Download {filename}
            </button>
          </div>
        </div>

        <div className="export-report">
          <span>
            {report.exported} resource{report.exported === 1 ? "" : "s"} exported
          </span>
          {report.skipped.length > 0 && (
            <span className="export-warn" title={report.skipped.map((s) => s.serviceId).join(", ")}>
              {report.skipped.length} skipped
            </span>
          )}
          {report.todos.length > 0 && (
            <span className="export-warn">{report.todos.length} field(s) need your input</span>
          )}
          <span className="export-note">
            Scaffold, not deploy-ready — property names follow Strata&apos;s model; complete the
            TODOs.
          </span>
        </div>

        <pre className="export-preview">{content}</pre>
      </div>
    </div>
  );
}

/** Native types pre-selected for a live scan, per provider (if present in the registry). */
const COMMON_DISCOVERY_TYPES: Record<CloudProvider, Set<string>> = {
  aws: new Set([
    "AWS::EC2::VPC",
    "AWS::EC2::Subnet",
    "AWS::EC2::Instance",
    "AWS::EC2::SecurityGroup",
    "AWS::S3::Bucket",
    "AWS::Lambda::Function",
    "AWS::RDS::DBInstance",
    "AWS::DynamoDB::Table",
  ]),
  gcp: new Set([
    "compute.googleapis.com/Instance",
    "compute.googleapis.com/Network",
    "compute.googleapis.com/Subnetwork",
    "storage.googleapis.com/Bucket",
    "sqladmin.googleapis.com/Instance",
    "container.googleapis.com/Cluster",
  ]),
  azure: new Set([
    "Microsoft.Compute/virtualMachines",
    "Microsoft.Network/virtualNetworks",
    "Microsoft.Storage/storageAccounts",
    "Microsoft.Sql/servers",
    "Microsoft.ContainerService/managedClusters",
    "Microsoft.Resources/resourceGroups",
  ]),
};

/** A provider-native discoverable type, uniform across providers for the UI. */
interface UnifiedType {
  native: string;
  label: string;
}

/** Registry-derived discoverable types for a provider, normalised to {native,label}. */
function discoverableTypesFor(provider: CloudProvider): UnifiedType[] {
  if (provider === "gcp")
    return listGcpDiscoverableTypes().map((t) => ({ native: t.assetType, label: t.label }));
  if (provider === "azure")
    return listAzureDiscoverableTypes().map((t) => ({ native: t.armType, label: t.label }));
  return listDiscoverableTypes().map((t) => ({ native: t.cfnType, label: t.label }));
}

const PROVIDER_LABEL: Record<CloudProvider, string> = { aws: "AWS", gcp: "GCP", azure: "Azure" };
const PROVIDER_ORDER: CloudProvider[] = ["aws", "gcp", "azure"];

/**
 * True on a shared/hosted deployment. The hosted instance must NOT fall back to
 * the operator's ambient credentials, so the UI requires the user to bring
 * their own keys (and the /api/discover route enforces the same). Inlined at
 * build time from the public env var.
 */
const STRATA_HOSTED =
  process.env.NEXT_PUBLIC_STRATA_HOSTED === "1" || process.env.NEXT_PUBLIC_STRATA_HOSTED === "true";

/**
 * Terraform/OpenTofu companion: map a local repo to a layered diagram, and
 * visualize a `plan` as a change overlay. Local-only (server reads the
 * filesystem + may run terraform); disabled on hosted deployments. Snapshots
 * persist to the storage folder (also local-only).
 */
function CompanionDialog() {
  const flow = useFlow();
  const { companionOpen, closeCompanion, importDiscoveredGraph } = flow;

  const [path, setPath] = React.useState("");
  const [roots, setRoots] = React.useState<RepoRoot[]>([]);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [strategy, setStrategy] = React.useState<"auto" | "static" | "resolved">("auto");
  const [phase, setPhase] = React.useState<"setup" | "detecting" | "roots" | "busy">("setup");
  const [error, setError] = React.useState<string | null>(null);
  const [report, setReport] = React.useState<RepoRootReport[] | null>(null);
  const [warnings, setWarnings] = React.useState<string[]>([]);
  const [planCounts, setPlanCounts] = React.useState<PlanDiff["counts"] | null>(null);
  const [planText, setPlanText] = React.useState("");
  const [snapshots, setSnapshots] = React.useState<StoreSnapshotMeta[]>([]);

  const dialogRef = useDialogA11y<HTMLDivElement>(companionOpen, closeCompanion);

  const refreshSnapshots = React.useCallback(() => {
    if (STRATA_HOSTED) return;
    listStoreSnapshots()
      .then(setSnapshots)
      .catch(() => setSnapshots([]));
  }, []);

  React.useEffect(() => {
    if (companionOpen) {
      setPhase("setup");
      setError(null);
      setReport(null);
      setWarnings([]);
      setPlanCounts(null);
      refreshSnapshots();
    }
  }, [companionOpen, refreshSnapshots]);

  if (!companionOpen) return null;

  const firstSelected = [...selected][0];

  const detect = async () => {
    setError(null);
    setPhase("detecting");
    try {
      const found = await detectRepoRoots(path.trim());
      if (found.length === 0) {
        setError("No Terraform root modules found under that path.");
        setPhase("setup");
        return;
      }
      setRoots(found);
      setSelected(new Set(found.map((r) => r.name)));
      setPhase("roots");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read that repository.");
      setPhase("setup");
    }
  };

  const toggleRoot = (name: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  // Apply a graph to the canvas; for a plan, also drive the change overlay.
  const apply = async (graph: Parameters<typeof importDiscoveredGraph>[0], diff?: PlanDiff) => {
    await importDiscoveredGraph(graph, "replace");
    if (diff) {
      flow.setPlanChanges(diff.changes);
      flow.setActiveOverlay("plan");
      setPlanCounts(diff.counts);
    } else {
      flow.setPlanChanges({});
      flow.setActiveOverlay("none");
    }
  };

  const doConnect = async () => {
    setError(null);
    setPhase("busy");
    try {
      const all = selected.size === roots.length;
      const r = await connectRepo({
        path: path.trim(),
        roots: all ? undefined : [...selected],
        strategy,
      });
      setReport(r.roots);
      setWarnings(r.warnings);
      await apply(r.graph);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to map the repository.");
    } finally {
      setPhase("roots");
    }
  };

  const doPlanRun = async () => {
    if (!firstSelected) return;
    setError(null);
    setPhase("busy");
    try {
      const r = await runPlan({ repoPath: path.trim(), root: firstSelected });
      setWarnings(r.warnings);
      await apply(r.graph, r.diff);
      closeCompanion();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Plan failed.");
    } finally {
      setPhase("roots");
    }
  };

  const doPlanPaste = async () => {
    setError(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(planText);
    } catch {
      setError("That isn't valid JSON. Paste the output of `terraform show -json <planfile>`.");
      return;
    }
    setPhase("busy");
    try {
      const r = await runPlan({ planJson: parsed });
      setWarnings(r.warnings);
      await apply(r.graph, r.diff);
      closeCompanion();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read that plan JSON.");
      setPhase(roots.length ? "roots" : "setup");
    }
  };

  const saveCurrent = async () => {
    try {
      await saveStoreSnapshot({
        name: flow.graphName || "diagram",
        graph: flow.snapshotGraph(),
        diff: planCounts ? { changes: flow.planChanges, counts: planCounts } : undefined,
        repo: path.trim() || undefined,
      });
      refreshSnapshots();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save snapshot.");
    }
  };

  const loadSnap = async (id: string) => {
    try {
      const snap = await loadStoreSnapshot(id);
      await apply(snap.graph, snap.diff);
      closeCompanion();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load snapshot.");
    }
  };

  const busy = phase === "busy" || phase === "detecting";

  return (
    <div className="hub-backdrop" onMouseDown={closeCompanion}>
      <div
        className="connect"
        role="dialog"
        aria-modal="true"
        aria-label="Terraform companion"
        ref={dialogRef}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="hub-header">
          <h2 className="hub-title">Terraform / OpenTofu companion</h2>
          <button className="hub-close" onClick={closeCompanion} aria-label="Close">
            ✕
          </button>
        </div>

        {STRATA_HOSTED ? (
          <p className="connect-note">
            The companion reads the local filesystem and runs Terraform, so it&rsquo;s available
            only on a local deployment — not on this hosted instance.
          </p>
        ) : (
          <>
            <p className="connect-note">
              Map a local Terraform / OpenTofu repo into a diagram, and visualize a{" "}
              <code>plan</code> as a change overlay. No cloud credentials are used to connect; the
              repo is never modified.
            </p>

            <label className="connect-field">
              <span>Repository path</span>
              <input
                type="text"
                value={path}
                placeholder="/Users/you/code/my-infrastructure"
                onChange={(e) => setPath(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && path.trim() && phase === "setup") detect();
                }}
              />
            </label>

            {phase !== "setup" && phase !== "detecting" && roots.length > 0 && (
              <>
                <div className="connect-rootlist">
                  <div className="connect-rootlist-head">
                    Roots ({selected.size}/{roots.length} selected)
                  </div>
                  {roots.map((r) => (
                    <label key={r.name} className="connect-root">
                      <input
                        type="checkbox"
                        checked={selected.has(r.name)}
                        onChange={() => toggleRoot(r.name)}
                      />
                      <span className="connect-root-name">{r.name}</span>
                      <span className="connect-root-dir">{r.dir}</span>
                    </label>
                  ))}
                </div>
                <label className="connect-field">
                  <span>Connect fidelity</span>
                  <select
                    value={strategy}
                    onChange={(e) => setStrategy(e.target.value as typeof strategy)}
                  >
                    <option value="auto">
                      Auto — resolve with terraform if available, else static
                    </option>
                    <option value="static">Static only — fast, offline, no terraform</option>
                    <option value="resolved">Resolved only — requires terraform/tofu</option>
                  </select>
                </label>
              </>
            )}

            {report && (
              <div className="connect-report">
                {report.map((r) => (
                  <div key={r.name} className="connect-report-row">
                    <span className="connect-root-name">{r.name}</span>
                    <span className={`connect-badge connect-badge-${r.strategy}`}>
                      {r.strategy}
                    </span>
                    <span className="connect-root-dir">{r.resourceCount} resource(s)</span>
                  </div>
                ))}
              </div>
            )}

            {planCounts && (
              <div className="plan-legend">
                <span className="plan-chip plan-create">+{planCounts.create} create</span>
                <span className="plan-chip plan-update">~{planCounts.update} update</span>
                <span className="plan-chip plan-replace">±{planCounts.replace} replace</span>
                <span className="plan-chip plan-delete">−{planCounts.delete} delete</span>
              </div>
            )}

            {warnings.length > 0 && (
              <ul className="connect-warnings">
                {warnings.slice(0, 6).map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            )}

            {error && <p className="connect-error">{error}</p>}

            <div className="connect-actions">
              {phase === "setup" || phase === "detecting" ? (
                <button className="btn-start" disabled={!path.trim() || busy} onClick={detect}>
                  {phase === "detecting" ? "Detecting…" : "Detect roots"}
                </button>
              ) : (
                <>
                  <button onClick={() => setPhase("setup")} disabled={busy}>
                    Back
                  </button>
                  <button disabled={selected.size === 0 || busy} onClick={doConnect}>
                    {phase === "busy" ? "Working…" : `Connect ${selected.size} root(s)`}
                  </button>
                  <button
                    className="btn-start"
                    disabled={!firstSelected || busy}
                    onClick={doPlanRun}
                    title="Run terraform plan in your repo (uses your backend + credentials)"
                  >
                    {`Plan ${firstSelected ?? ""}`.trim()}
                  </button>
                </>
              )}
            </div>

            <details className="companion-advanced">
              <summary>Visualize a plan JSON (no credentials)</summary>
              <p className="connect-note">
                Paste the output of <code>terraform show -json &lt;planfile&gt;</code> to overlay
                the changes without Strata running terraform.
              </p>
              <textarea
                className="companion-plan-text"
                value={planText}
                placeholder='{ "resource_changes": [ … ] }'
                onChange={(e) => setPlanText(e.target.value)}
              />
              <div className="connect-actions">
                <button
                  className="btn-start"
                  disabled={!planText.trim() || busy}
                  onClick={doPlanPaste}
                >
                  Visualize plan JSON
                </button>
              </div>
            </details>

            {snapshots.length > 0 && (
              <div className="companion-snapshots">
                <div className="connect-rootlist-head">Saved snapshots ({snapshots.length})</div>
                {snapshots.slice(0, 8).map((s) => (
                  <button key={s.id} className="companion-snap" onClick={() => loadSnap(s.id)}>
                    <span className="connect-root-name">{s.name}</span>
                    {s.hasDiff && (
                      <span className="connect-badge connect-badge-resolved">plan</span>
                    )}
                    <span className="connect-root-dir">
                      {s.resourceCount} res · {new Date(s.createdAt).toLocaleString()}
                    </span>
                  </button>
                ))}
              </div>
            )}

            <div className="connect-actions">
              <button onClick={saveCurrent} disabled={busy}>
                Save current to storage folder
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** "Connect to AWS" discovery sub-flow: source → scope → discover → review →
 *  import. Live scans run server-side via /api/discover; on a hosted deployment
 *  the user brings their own credentials (sent per-request, never stored). The
 *  paste path normalises an existing export with no credentials at all. */
function ConnectDialog() {
  const { connectOpen, closeConnect, importDiscoveredGraph } = useFlow();

  const [provider, setProvider] = React.useState<CloudProvider>("aws");
  const allTypes = React.useMemo<UnifiedType[]>(() => discoverableTypesFor(provider), [provider]);

  const [source, setSource] = React.useState<"live" | "paste">("live");
  const [region, setRegion] = React.useState("us-east-1");
  const [gcpScope, setGcpScope] = React.useState("projects/my-project");
  const [azureSubs, setAzureSubs] = React.useState("");
  const [accessKeyId, setAccessKeyId] = React.useState("");
  const [secretAccessKey, setSecretAccessKey] = React.useState("");
  const [sessionToken, setSessionToken] = React.useState("");
  const [selected, setSelected] = React.useState<Set<string>>(
    () => new Set(COMMON_DISCOVERY_TYPES.aws),
  );
  const [filter, setFilter] = React.useState("");
  const [pasteText, setPasteText] = React.useState("");
  const [phase, setPhase] = React.useState<"setup" | "running" | "review">("setup");
  const [error, setError] = React.useState<string | null>(null);
  const [found, setFound] = React.useState<DiscoveredResource[]>([]);
  const [scanNote, setScanNote] = React.useState<string>("");
  const [warnings, setWarnings] = React.useState<string[]>([]);

  // When the provider changes, reset the type selection to that provider's
  // common defaults (intersected with what the registry models) and go back to
  // the setup step so a stale review can't be imported under a new provider.
  React.useEffect(() => {
    const available = new Set(discoverableTypesFor(provider).map((t) => t.native));
    setSelected(new Set([...COMMON_DISCOVERY_TYPES[provider]].filter((t) => available.has(t))));
    setPhase("setup");
    setFound([]);
    setError(null);
    setFilter("");
  }, [provider]);

  const dialogRef = useDialogA11y<HTMLDivElement>(connectOpen, closeConnect);

  if (!connectOpen) return null;

  const visibleTypes = filter
    ? allTypes.filter(
        (t) =>
          t.label.toLowerCase().includes(filter.toLowerCase()) ||
          t.native.toLowerCase().includes(filter.toLowerCase()),
      )
    : allTypes;

  const toggleType = (native: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(native)) next.delete(native);
      else next.add(native);
      return next;
    });

  const scopeLabel = provider === "aws" ? region : provider === "gcp" ? gcpScope : azureSubs;
  // GCP/Azure live scans use the server's ambient creds, which a hosted
  // instance won't expose — so they're only available on a local deployment.
  const liveBlocked = STRATA_HOSTED && provider !== "aws";

  // Select-all acts on the currently *visible* (filtered) types: filter, then
  // "Select all" adds just the matches. Toggles to "Clear" once all are on.
  const allVisibleSelected =
    visibleTypes.length > 0 && visibleTypes.every((t) => selected.has(t.native));
  const toggleAllVisible = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const t of visibleTypes) {
        if (allVisibleSelected) next.delete(t.native);
        else next.add(t.native);
      }
      return next;
    });

  const runLive = async () => {
    setError(null);
    setPhase("running");
    try {
      if (provider === "aws") {
        const creds = accessKeyId.trim()
          ? {
              accessKeyId: accessKeyId.trim(),
              secretAccessKey: secretAccessKey.trim(),
              sessionToken: sessionToken.trim() || undefined,
            }
          : undefined;
        const result = await runDiscovery({ region, types: [...selected], creds });
        setFound(result.resources);
        setScanNote(`scanned ${result.scanned.length} type(s) in ${region}`);
        setWarnings(result.warnings);
      } else if (provider === "gcp") {
        const result = await runGcpDiscovery({ scope: gcpScope, types: [...selected] });
        setFound(result.resources);
        setScanNote(`scanned ${gcpScope}`);
        setWarnings(result.warnings);
      } else {
        const subscriptions = azureSubs
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        const result = await runAzureDiscovery({ subscriptions, types: [...selected] });
        setFound(result.resources);
        setScanNote(`scanned ${result.scanned.subscriptions} subscription(s)`);
        setWarnings(result.warnings);
      }
      setPhase("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Discovery failed.");
      setPhase("setup");
    }
  };

  const runPaste = () => {
    setError(null);
    try {
      const resources =
        provider === "gcp"
          ? parseGcpExport(pasteText)
          : provider === "azure"
            ? parseAzureExport(pasteText)
            : parsePastedExport(pasteText);
      setFound(resources);
      setScanNote("");
      setWarnings([]);
      setPhase("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not parse the pasted export.");
    }
  };

  const doImport = (mode: "merge" | "replace") => {
    const graph = mapDiscoveredToGraph(found, {
      name: `${PROVIDER_LABEL[provider]} discovery (${scopeLabel || "scan"})`,
    });
    importDiscoveredGraph(graph, mode);
  };

  const unmapped = phase === "review" ? unmappedTypes(found) : [];
  const mappableCount =
    found.length - found.filter((r) => unmapped.includes(r.resourceType)).length;

  return (
    <div className="hub-backdrop" onMouseDown={closeConnect}>
      <div
        className="connect"
        role="dialog"
        aria-modal="true"
        aria-label="Connect to cloud"
        ref={dialogRef}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="hub-header">
          <h2 className="hub-title">Connect to cloud</h2>
          <button className="hub-close" onClick={closeConnect} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="connect-seg" role="tablist" aria-label="Cloud provider">
          {PROVIDER_ORDER.map((p) => (
            <button
              key={p}
              role="tab"
              aria-selected={provider === p}
              className={provider === p ? "active" : ""}
              onClick={() => setProvider(p)}
            >
              {PROVIDER_LABEL[p]}
            </button>
          ))}
        </div>

        <div className="connect-seg" role="tablist" aria-label="Discovery source">
          <button
            role="tab"
            aria-selected={source === "live"}
            className={source === "live" ? "active" : ""}
            onClick={() => setSource("live")}
          >
            Live scan
          </button>
          <button
            role="tab"
            aria-selected={source === "paste"}
            className={source === "paste" ? "active" : ""}
            onClick={() => setSource("paste")}
          >
            Paste export
          </button>
        </div>

        {error && <div className="connect-error">{error}</div>}

        {source === "live" ? (
          <div className="connect-body">
            <div className="connect-privacy" role="note">
              <span className="connect-privacy-icon" aria-hidden="true">
                🔒
              </span>
              <span>
                {provider === "aws" ? (
                  <>
                    Your credentials are <strong>never stored</strong>. They&apos;re sent over
                    HTTPS, used in-memory for this one scan, then discarded — never written to disk,
                    logged, or saved into the diagram. Prefer <strong>temporary, read-only</strong>{" "}
                    keys.
                  </>
                ) : (
                  <>
                    No credentials are entered or sent here. The scan runs server-side with the
                    machine&apos;s{" "}
                    <strong>ambient {provider === "gcp" ? "ADC" : "Azure"} credentials</strong> and
                    returns only resource descriptions — credentials are{" "}
                    <strong>never stored</strong>, returned, or saved into the diagram.
                  </>
                )}
              </span>
            </div>
            {provider === "aws" && (
              <>
                <label className="export-field">
                  <span>Access key ID{STRATA_HOSTED ? "" : " (optional)"}</span>
                  <input
                    value={accessKeyId}
                    onChange={(e) => setAccessKeyId(e.target.value)}
                    placeholder="AKIA… / ASIA…"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </label>
                <label className="export-field">
                  <span>Secret access key</span>
                  <input
                    type="password"
                    value={secretAccessKey}
                    onChange={(e) => setSecretAccessKey(e.target.value)}
                    placeholder="••••••••••••••••"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </label>
                <label className="export-field">
                  <span>Session token (recommended)</span>
                  <input
                    type="password"
                    value={sessionToken}
                    onChange={(e) => setSessionToken(e.target.value)}
                    placeholder="Temporary STS credentials — leave blank for permanent keys"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </label>
                <label className="export-field">
                  <span>Region</span>
                  <input
                    value={region}
                    onChange={(e) => setRegion(e.target.value)}
                    placeholder="us-east-1"
                  />
                </label>
              </>
            )}
            {provider === "gcp" && (
              <label className="export-field">
                <span>Scope</span>
                <input
                  value={gcpScope}
                  onChange={(e) => setGcpScope(e.target.value)}
                  placeholder="projects/my-project | folders/123 | organizations/456"
                />
              </label>
            )}
            {provider === "azure" && (
              <label className="export-field">
                <span>Subscription id(s)</span>
                <input
                  value={azureSubs}
                  onChange={(e) => setAzureSubs(e.target.value)}
                  placeholder="comma-separated subscription GUIDs"
                />
              </label>
            )}
            <div className="connect-types-head">
              <span>Resource types ({selected.size} selected)</span>
              <button
                type="button"
                className="connect-selectall"
                onClick={toggleAllVisible}
                disabled={visibleTypes.length === 0}
                title={
                  filter
                    ? `${allVisibleSelected ? "Clear" : "Select"} the ${visibleTypes.length} filtered type(s)`
                    : undefined
                }
              >
                {allVisibleSelected ? "Clear" : "Select all"}
                {filter ? ` (${visibleTypes.length})` : ""}
              </button>
              <input
                className="connect-filter"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter…"
              />
            </div>
            <div className="connect-types">
              {visibleTypes.map((t) => (
                <label key={t.native} className="connect-type">
                  <input
                    type="checkbox"
                    checked={selected.has(t.native)}
                    onChange={() => toggleType(t.native)}
                  />
                  <span>{t.label}</span>
                  <span className="connect-type-cfn">{t.native}</span>
                </label>
              ))}
            </div>
            {provider === "aws" ? (
              <div className="connect-note">
                Use <strong>temporary, read-only</strong> credentials — run{" "}
                <code>aws sts get-session-token</code> or assume a read-only role, and prefer the{" "}
                <code>ReadOnlyAccess</code> policy. Keys are sent over HTTPS, used for this one
                scan, and never stored, logged, or saved into the diagram.
                {!STRATA_HOSTED &&
                  " Leave the keys blank to use this server's own credentials (local use only)."}{" "}
                Relationships aren&apos;t inferred from Cloud Control — discovered resources land as
                nodes you can wire up.
              </div>
            ) : (
              <div className="connect-note">
                {provider === "gcp" ? (
                  <>
                    Live scans use the server&apos;s{" "}
                    <strong>Application Default Credentials</strong> via Cloud Asset Inventory — run{" "}
                    <code>gcloud auth application-default login</code> (read-only). Nothing is
                    stored or saved into the diagram.
                  </>
                ) : (
                  <>
                    Live scans use the server&apos;s <strong>DefaultAzureCredential</strong> via
                    Azure Resource Graph — run <code>az login</code> (read-only). Nothing is stored
                    or saved into the diagram.
                  </>
                )}{" "}
                {liveBlocked &&
                  "Live scans are disabled on this hosted instance — use Paste export."}
              </div>
            )}
            <div className="connect-actions">
              <button
                className="btn-start"
                disabled={
                  phase === "running" ||
                  selected.size === 0 ||
                  liveBlocked ||
                  (provider === "azure" && !azureSubs.trim()) ||
                  (provider === "gcp" && !gcpScope.trim()) ||
                  (provider === "aws" &&
                    STRATA_HOSTED &&
                    !(accessKeyId.trim() && secretAccessKey.trim()))
                }
                onClick={runLive}
              >
                {phase === "running" ? "Scanning…" : "Discover"}
              </button>
            </div>
          </div>
        ) : (
          <div className="connect-body">
            <div className="connect-note">
              {provider === "aws" &&
                "Paste the output of `aws cloudcontrol list-resources --type-name …` (or a JSON array of resources)."}
              {provider === "gcp" &&
                "Paste the output of `gcloud asset list --format=json` (or a JSON array of assets)."}
              {provider === "azure" &&
                'Paste the output of `az graph query -q "Resources" -o json` (or a JSON array of resources).'}{" "}
              Nothing is sent anywhere — parsing happens locally.
            </div>
            <textarea
              className="connect-paste"
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder={
                provider === "gcp"
                  ? '[ { "assetType": "storage.googleapis.com/Bucket", "resource": { "data": { … } } } ]'
                  : provider === "azure"
                    ? '{ "data": [ { "type": "Microsoft.Storage/storageAccounts", "name": "…" } ] }'
                    : '{ "TypeName": "AWS::S3::Bucket", "ResourceDescriptions": [ … ] }'
              }
            />
            <div className="connect-actions">
              <button className="btn-start" disabled={!pasteText.trim()} onClick={runPaste}>
                Parse
              </button>
            </div>
          </div>
        )}

        {phase === "review" && (
          <div className="connect-review">
            <div className="connect-review-summary">
              <strong>{mappableCount}</strong> resource{mappableCount === 1 ? "" : "s"} ready to
              import
              {unmapped.length > 0 && (
                <span className="export-warn"> · {unmapped.length} unmapped type(s)</span>
              )}
              {scanNote && <span className="connect-scanned"> · {scanNote}</span>}
            </div>
            {unmapped.length > 0 && (
              <div className="connect-note">Not yet modelled (skipped): {unmapped.join(", ")}</div>
            )}
            {provider !== "aws" && (
              <div className="connect-note">
                Resources import as typed nodes; most property fields aren&apos;t mapped yet (the
                provider&apos;s field names differ from Strata&apos;s config), so the inspector may
                be sparse. Relationships aren&apos;t inferred — wire them up on the canvas.
              </div>
            )}
            {warnings.map((w, i) => (
              <div className="connect-note connect-warn" key={i}>
                {w}
              </div>
            ))}
            <div className="connect-actions">
              <button onClick={() => doImport("merge")} disabled={mappableCount === 0}>
                Merge into canvas
              </button>
              <button
                className="btn-start"
                onClick={() => doImport("replace")}
                disabled={mappableCount === 0}
              >
                Replace canvas
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <FlowProvider>
      <Workspace />
    </FlowProvider>
  );
}

function Workspace() {
  const {
    presentation,
    setPresentation,
    review,
    cloudMap,
    cloudMapTarget,
    mapToTarget,
    goToResource,
    applyAutofix,
  } = useFlow();
  return (
    <>
      <div className={`app${presentation ? " app--present" : ""}`}>
        <TopBar />
        <aside className="panel">
          <h3>Palette</h3>
          <Palette readOnly={presentation} />
          <div className="help">
            Drag items onto empty canvas or on top of a node. Hold{" "}
            <span className="kbd">Space</span> to pan. Press <span className="kbd">C</span> to
            toggle Connect mode, or click a small dot on a node to start a wire, then click the
            target node.
          </div>
          <h3>Modes</h3>
          <ModeButtons />
          <h3>Density</h3>
          <DensityButtons />
          <h3>Layers &amp; Views</h3>
          <LayersPanel />
        </aside>
        <main className="canvas-wrap" id="canvasWrap" aria-label="Diagram canvas">
          <Canvas />
          <ValidationBadge />
          <DriftPanel />
        </main>
        <aside className="right">
          <h3>Inspector</h3>
          <Inspector />
          <h3>Account review</h3>
          <ReviewPanel review={review} onSelectResource={goToResource} onApplyFix={applyAutofix} />
          <h3>Migrate</h3>
          <MigratePanel
            onMap={mapToTarget}
            result={cloudMap}
            target={cloudMapTarget ?? undefined}
            onSelectResource={goToResource}
          />
          <FooterControls />
        </aside>
      </div>
      <CommandPalette />
      <Tour />
      <StartHub />
      <ExportDialog />
      <CompareDialog />
      <VersionsDialog />
      <MergePreviewDialog />
      <ConnectDialog />
      <CompanionDialog />
      <ReplaceConfirmDialog />
      {presentation && (
        <button className="present-exit" onClick={() => setPresentation(false)}>
          Exit presentation
        </button>
      )}
      <div className="toast" id="toast" />
    </>
  );
}
