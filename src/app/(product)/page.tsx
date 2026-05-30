"use client";
import React from "react";
import { FlowProvider, useFlow } from "../../hooks/useFlow";
import { Palette } from "../../components/Palette";
import { Canvas } from "../../components/Canvas";
import { Inspector } from "../../components/Inspector";
import { CATEGORIES, CATEGORY_ORDER } from "../../aws/categories";
import type { GraphSummary } from "../../aws/model";

/** Dropdown listing saved graphs (name · resource count · updated), replacing
 *  the old window.prompt "Load from Server" flow. */
function LoadMenu() {
  const { listSavedGraphs, loadGraph, deleteSavedGraph } = useFlow();
  const [open, setOpen] = React.useState(false);
  const [graphs, setGraphs] = React.useState<GraphSummary[] | null>(null);
  const ref = React.useRef<HTMLDivElement>(null);

  const refresh = React.useCallback(async () => {
    setGraphs(null);
    setGraphs(await listSavedGraphs());
  }, [listSavedGraphs]);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next) await refresh();
  };

  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div className="load-menu" ref={ref}>
      <button
        onClick={toggle}
        title="Load graph from server"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        Load from Server ▾
      </button>
      {open && (
        <div className="load-menu-dropdown" role="menu">
          {graphs === null && <div className="load-menu-empty">Loading…</div>}
          {graphs && graphs.length === 0 && <div className="load-menu-empty">No saved graphs.</div>}
          {graphs?.map((g) => (
            <div className="load-menu-item" key={g.id}>
              <button
                className="load-menu-pick"
                role="menuitem"
                onClick={async () => {
                  setOpen(false);
                  await loadGraph(g.id);
                }}
              >
                <span className="load-menu-name">{g.name}</span>
                <span className="load-menu-meta">
                  {g.resourceCount} resource{g.resourceCount === 1 ? "" : "s"}
                  {g.updatedAt ? ` · ${new Date(g.updatedAt).toLocaleDateString()}` : ""}
                </span>
              </button>
              <button
                className="load-menu-delete"
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
        </div>
      )}
    </div>
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
  } = useFlow();
  return (
    <div className="topbar">
      <div className="logo">
        <span role="img" aria-label="Strata logo">
          🔶
        </span>{" "}
        <span style={{ fontWeight: 800 }}>Strata</span>
      </div>
      <div className="status" id="status">
        {status}
      </div>
      <div className="toolbar">
        <button onClick={undo} disabled={!canUndo} title="Undo (⌘Z / Ctrl+Z)">
          Undo
        </button>
        <button onClick={redo} disabled={!canRedo} title="Redo (⇧⌘Z / Ctrl+Y)">
          Redo
        </button>
        <button onClick={runValidateUI} title="Check architecture">
          Validate
        </button>
        <button onClick={runRulesUI} title="Suggest rules for SG/NACL/Routes">
          Suggest Rules
        </button>
        <button onClick={exportJSON}>Export JSON</button>
        <button onClick={importJSONDialog}>Import JSON</button>
        <button onClick={importIaCDialog} title="Import Terraform or CloudFormation">
          Import IaC
        </button>
        <button onClick={saveToServer} title="Save graph to server">
          Save to Server
        </button>
        <LoadMenu />
        <button onClick={clear} title="Clear canvas">
          Clear
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
  const { fitToView, center } = useFlow();
  return (
    <div className="footer">
      <button onClick={fitToView}>Fit to View</button>
      <button onClick={center}>Center</button>
    </div>
  );
}

export default function Page() {
  return (
    <FlowProvider>
      <div className="app">
        <TopBar />
        <aside className="panel">
          <h3>Palette</h3>
          <Palette />
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
          <h3>Shortcuts</h3>
          <div className="help">
            <div>Scroll: pan · ⌘/Ctrl+scroll or pinch: zoom</div>
            <div>Drag empty canvas: marquee-select</div>
            <div>Delete: remove selected node(s)/edge</div>
            <div>D: duplicate selected node</div>
            <div>G: group selected into VPC</div>
          </div>
          <h3>Legend</h3>
          <div className="palette" style={{ gridTemplateColumns: "1fr" }}>
            {CATEGORY_ORDER.map((id) => (
              <div className="item" key={id}>
                <span className="dot" style={{ background: CATEGORIES[id].color }}></span>{" "}
                {CATEGORIES[id].name}
              </div>
            ))}
          </div>
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
      <div className="toast" id="toast" />
    </FlowProvider>
  );
}
