"use client";
import React from "react";
import { FlowProvider, useFlow } from "../../hooks/useFlow";
import { Palette } from "../../components/Palette";
import { Canvas } from "../../components/Canvas";
import { Inspector } from "../../components/Inspector";
import { CommandPalette } from "../../components/CommandPalette";
import { CATEGORIES, CATEGORY_ORDER } from "../../aws/categories";
import { RELATIONSHIP_CLASSES, RELATIONSHIP_CLASS_ORDER } from "../../aws/relationshipClasses";
import type { GraphSummary } from "../../aws/model";
import { exportIaC, type ExportFormat } from "../../aws/iacExport";
import { listDiscoverableTypes, parsePastedExport } from "../../aws/discovery";
import { listGcpDiscoverableTypes, parseGcpExport } from "../../gcp/discovery";
import { listAzureDiscoverableTypes, parseAzureExport } from "../../azure/discovery";
import { mapDiscoveredToGraph, unmappedTypes, type DiscoveredResource } from "../../aws/mcp";
import type { CloudProvider } from "../../aws/types";
import { runDiscovery, runGcpDiscovery, runAzureDiscovery } from "../../lib/api";

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
          ] as const
        ).map((o) => (
          <button
            key={o.id}
            className={`chip ${activeOverlay === o.id ? "on" : "off"}`}
            onClick={() => setActiveOverlay(o.id)}
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
 *  Esc to close. Extracted from the old LoadMenu so the toolbar's File / Analyze
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
    <Menu label="Open ▾" title="Open a saved graph from the server" align="right" onOpen={refresh}>
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
    importJSONDialog,
    importIaCDialog,
    clear,
    status,
    undo,
    redo,
    canUndo,
    canRedo,
    saveToServer,
    setPresentation,
    openStartHub,
    openExportIaC,
  } = useFlow();
  return (
    <div className="topbar">
      <div className="logo">
        <span role="img" aria-label="Strata logo">
          🔶
        </span>{" "}
        <span style={{ fontWeight: 800 }}>Strata</span>
      </div>
      <a
        className="topbar-link"
        href="/docs"
        target="_blank"
        rel="noreferrer"
        title="Open the documentation (User Guide & Architecture) in a new tab"
      >
        Docs ↗
      </a>
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

        {/* Server actions — Save + Open are the two server-side file ops. */}
        <button
          className="icon-btn"
          onClick={saveToServer}
          title="Save graph to server"
          aria-label="Save to server"
        >
          💾
        </button>
        <LoadMenu />

        <span className="toolbar-divider" aria-hidden="true" />

        {/* File: local import/export + clear. (⌘K palette remains the full index.) */}
        <Menu label="File ▾" title="Import, export, and clear" align="right">
          <MenuItem onClick={importJSONDialog}>Import JSON…</MenuItem>
          <MenuItem onClick={importIaCDialog} title="Import Terraform or CloudFormation">
            Import IaC (Terraform / CloudFormation)…
          </MenuItem>
          <div className="menu-divider" />
          <MenuItem onClick={exportJSON}>Export JSON</MenuItem>
          <MenuItem
            onClick={openExportIaC}
            title="Generate Terraform / CloudFormation from the diagram"
          >
            Export to IaC…
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

function PresetButtons() {
  const { loadPreset } = useFlow();
  return (
    <div className="palette">
      <button onClick={() => loadPreset("aws-basic")}>Basic AWS</button>
      <button onClick={() => loadPreset("ecs-alb")}>ECS + ALB</button>
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
    openExportIaC,
    openConnect,
    state,
  } = useFlow();
  const dialogRef = React.useRef<HTMLDivElement>(null);
  const prevFocusRef = React.useRef<HTMLElement | null>(null);

  React.useEffect(() => {
    if (!startHubOpen) return;
    prevFocusRef.current = document.activeElement as HTMLElement | null;
    requestAnimationFrame(() => {
      dialogRef.current?.querySelector<HTMLElement>("button, [tabindex]")?.focus();
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeStartHub();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      prevFocusRef.current?.focus?.();
    };
  }, [startHubOpen, closeStartHub]);

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
              Terraform or CloudFormation. Maps known resource types into an editable diagram;
              unmapped types are listed after import.
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
              void loadPreset("aws-basic");
            }}
          >
            <span className="hub-card-icon" aria-hidden="true">
              🧩
            </span>
            <span className="hub-card-title">Start from a template</span>
            <span className="hub-card-desc">Begin with a ready-made architecture (Basic AWS).</span>
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

        <HubSavedGraphs />
      </div>
    </div>
  );
}

/** Confirmation shown before a replace action would discard unsaved work.
 *  Renders above the hub. */
function ReplaceConfirmDialog() {
  const { replaceConfirmOpen, resolveReplaceConfirm } = useFlow();
  React.useEffect(() => {
    if (!replaceConfirmOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") resolveReplaceConfirm("cancel");
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [replaceConfirmOpen, resolveReplaceConfirm]);

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
  { id: "terraform", label: "Terraform (HCL)" },
];

/** Export-to-IaC dialog: pick a format, preview the scaffold, see the coverage
 *  report (the honesty surface), then copy or download. */
function ExportDialog() {
  const { exportIaCOpen, closeExportIaC, snapshotGraph } = useFlow();
  const [format, setFormat] = React.useState<ExportFormat>("cloudformation-yaml");
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (!exportIaCOpen) return;
    setCopied(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeExportIaC();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [exportIaCOpen, closeExportIaC, format]);

  // Recompute only while open and when the format changes.
  const result = React.useMemo(
    () => (exportIaCOpen ? exportIaC(snapshotGraph(), format) : null),
    [exportIaCOpen, format, snapshotGraph],
  );

  if (!exportIaCOpen || !result) return null;
  const { content, filename, report } = result;

  const download = () => {
    const blob = new Blob([content], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
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

  React.useEffect(() => {
    if (!connectOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeConnect();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [connectOpen, closeConnect]);

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
  const { presentation, setPresentation } = useFlow();
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
          <h3>Presets</h3>
          <PresetButtons />
          <h3>Modes</h3>
          <ModeButtons />
          <h3>Density</h3>
          <DensityButtons />
          <h3>Shortcuts</h3>
          <div className="help">
            <div>Scroll: pan · ⌘/Ctrl+scroll or pinch: zoom</div>
            <div>Drag empty canvas: marquee-select</div>
            <div>Delete: remove selected node(s)/edge</div>
            <div>D: duplicate selected node</div>
            <div>G: group selected into VPC</div>
          </div>
          <h3>Layers &amp; Views</h3>
          <LayersPanel />
        </aside>
        <main className="canvas-wrap" id="canvasWrap">
          <Canvas />
        </main>
        <aside className="right">
          <h3>Inspector</h3>
          <Inspector />
          <FooterControls />
        </aside>
      </div>
      <CommandPalette />
      <StartHub />
      <ExportDialog />
      <ConnectDialog />
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
