"use client";
import React from "react";
import { FlowProvider, useFlow } from "../hooks/useFlow";
import { Palette } from "../components/Palette";
import { Canvas } from "../components/Canvas";
import { Inspector } from "../components/Inspector";
import { CATEGORIES, CATEGORY_ORDER } from "../aws/categories";

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
    loadFromServer,
  } = useFlow();
  return (
    <div className="topbar">
      <div className="logo">
        <span role="img" aria-label="AWS Flow Builder logo">
          🔶
        </span>{" "}
        <span style={{ fontWeight: 800 }}>AWS Flow Builder</span>
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
        <button onClick={loadFromServer} title="Load graph from server">
          Load from Server
        </button>
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
            <div>Delete: remove selected node/edge</div>
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
          <div className="grid" />
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
