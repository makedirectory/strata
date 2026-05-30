"use client";
import React, { createContext, useContext, useRef, useCallback, useEffect } from "react";
import { useFlowStore } from "./useFlowStore";
import { useCanvasInteraction } from "./useCanvasInteraction";
import { useCanvasRenderer } from "./useCanvasRenderer";
import type { ResourceInstance, Relationship, InfrastructureGraph } from "../aws/model";
import { emptyGraph, DEFAULT_NODE_SIZE } from "../aws/model";
import type { CanvasMode, Selection } from "../types";
import type { RelationshipKind } from "../aws/types";
import { defaultConfig, getService } from "../aws/registry";
import {
  validateArchitecture,
  suggestRules as suggestRulesEngine,
  type ValidationResult,
  type RuleSuggestion,
} from "../aws/rules";
import { listGraphs, getGraph, createGraph, updateGraph } from "../lib/api";
import { importIaC } from "../aws/iac";
import { zoomAbout, zoomByFactor, fitView, boundsOf, type Rect } from "../canvas/geometry";

interface FlowContextValue {
  state: {
    resources: ResourceInstance[];
    relationships: Relationship[];
    viewport: ReturnType<typeof useFlowStore>["viewport"];
    mode: CanvasMode;
  };
  worldRef: React.RefObject<HTMLDivElement | null>;
  svgRef: React.RefObject<SVGSVGElement | null>;
  minimapRef: React.RefObject<HTMLCanvasElement | null>;
  selection: Selection;

  // Actions
  setMode: (m: CanvasMode) => void;
  toggleMode: () => void;
  select: (sel: Selection) => void;
  addResourceFromPalette: (serviceId: string, x: number, y: number) => void;
  removeSelection: () => void;
  duplicateSelection: () => void;
  groupIntoVPC: () => void;
  updateResourceField: (patch: {
    name?: string;
    region?: string;
    config?: Record<string, unknown>;
  }) => void;
  updateRelationshipKind: (kind: RelationshipKind) => void;

  // Canvas interaction
  onCanvasMouseDown: (e: React.MouseEvent) => void;
  onCanvasClick: () => void;
  onMouseMove: (e: MouseEvent) => void;
  onMouseUp: () => void;
  onWheelZoom: (e: WheelEvent) => void;
  setSpacePressed: (pressed: boolean) => void;

  // Canvas rendering
  draw: () => void;
  drawMinimap: () => void;
  fitToView: () => void;
  center: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomReset: () => void;
  zoomToSelection: () => void;

  // History
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;

  // Sidebar / IO
  /** Alias of {@link runValidateUI}, consumed by the top toolbar. */
  validate: () => void;
  /** Alias of {@link runRulesUI}, consumed by the top toolbar. */
  suggestRules: () => void;
  exportJSON: () => void;
  importJSONDialog: () => void;
  importIaCDialog: () => void;
  clear: () => void;
  loadPreset: (presetName: string) => void;
  runValidateUI: () => void;
  runRulesUI: () => void;
  saveToServer: () => void;
  loadFromServer: () => void;
  /** Structured validation findings, or `null` before the first run. */
  validationResults: ValidationResult[] | null;
  /** Structured rule suggestions, or `null` before the first run. */
  ruleSuggestions: RuleSuggestion[] | null;
  status: string;
}

const FlowContext = createContext<FlowContextValue | null>(null);

/** Access the Flow context. Throws if used outside a {@link FlowProvider}. */
export const useFlow = (): FlowContextValue => {
  const ctx = useContext(FlowContext);
  if (ctx === null) {
    throw new Error("useFlow must be used within a <FlowProvider>.");
  }
  return ctx;
};

export const FlowProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const worldRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const minimapRef = useRef<HTMLCanvasElement>(null);

  const store = useFlowStore();
  const interaction = useCanvasInteraction();
  const renderer = useCanvasRenderer(worldRef, svgRef, minimapRef);

  // Destructure the stable (useCallback) members so handler deps below stay
  // referentially stable across renders.
  const {
    screenToWorld,
    onMouseMove: iOnMouseMove,
    onMouseUp: iOnMouseUp,
    onWheelZoom: iOnWheelZoom,
    onNodeMouseDown: iOnNodeMouseDown,
    onConnect: iOnConnect,
    fitToView: iFitToView,
    center: iCenter,
  } = interaction;
  const { draw: rDraw, drawMinimap: rDrawMinimap } = renderer;

  const [validationResults, setValidationResults] = React.useState<ValidationResult[] | null>(null);
  const [ruleSuggestions, setRuleSuggestions] = React.useState<RuleSuggestion[] | null>(null);
  const [status, setStatus] = React.useState<string>("Pan with space ⎵ + drag. Connect mode: C.");

  const state = {
    resources: store.resources,
    relationships: store.relationships,
    viewport: store.viewport,
    mode: store.mode,
  };

  /** Assemble the current model into an InfrastructureGraph. */
  const buildGraph = useCallback((): InfrastructureGraph => {
    const base = emptyGraph("AWS Architecture");
    return {
      ...base,
      id: store.graphId || "",
      accounts: store.accounts,
      resources: store.resources,
      relationships: store.relationships,
      viewport: store.viewport,
    };
  }, [store.graphId, store.accounts, store.resources, store.relationships, store.viewport]);

  const { setMode: storeSetMode, addResource: storeAddResource } = store;

  const toggleMode = useCallback(
    () => storeSetMode(store.mode === "connect" ? "move" : "connect"),
    [storeSetMode, store.mode],
  );

  const addResourceFromPalette = useCallback(
    (serviceId: string, x: number, y: number) => {
      const world = screenToWorld({ x, y }, store.viewport);
      storeAddResource(serviceId, world.x, world.y);
    },
    [screenToWorld, storeAddResource, store.viewport],
  );

  // Keep the selection's cached `resource` / `relationship` snapshot fresh
  // when the underlying model changes (e.g. after an inspector edit).
  const {
    selection: storeSelection,
    resources: storeResources,
    relationships: storeRelationships,
    setSelection,
  } = store;
  useEffect(() => {
    const sel = storeSelection;
    if (!sel) return;
    if (sel.type === "node") {
      const r = storeResources.find((x) => x.id === sel.id);
      if (r && r !== sel.resource) {
        setSelection({ type: "node", id: r.id, resource: r });
      }
    } else if (sel.type === "edge") {
      const rel = storeRelationships.find((x) => x.id === sel.id);
      if (rel) {
        const from = storeResources.find((x) => x.id === rel.from);
        const to = storeResources.find((x) => x.id === rel.to);
        if (rel !== sel.relationship) {
          setSelection({
            type: "edge",
            id: rel.id,
            relationship: rel,
            fromName: from?.name ?? rel.from,
            toName: to?.name ?? rel.to,
          });
        }
      }
    }
  }, [storeSelection, storeResources, storeRelationships, setSelection]);

  const {
    updateResource: storeUpdateResource,
    updateRelationshipKind: storeUpdateRelationshipKind,
    updateResourcePosition,
    setViewport: storeSetViewport,
    getViewport,
    commitCurrentState,
    setSelection: storeSetSelection,
    connect: storeConnect,
  } = store;

  const updateResourceField = useCallback(
    (patch: { name?: string; region?: string; config?: Record<string, unknown> }) => {
      if (store.selection?.type !== "node") return;
      storeUpdateResource(store.selection.id, patch);
    },
    [store.selection, storeUpdateResource],
  );

  const updateRelationshipKind = useCallback(
    (kind: RelationshipKind) => {
      if (store.selection?.type !== "edge") return;
      storeUpdateRelationshipKind(store.selection.id, kind);
    },
    [store.selection, storeUpdateRelationshipKind],
  );

  const onMouseMove = useCallback(
    (e: MouseEvent) => {
      iOnMouseMove(e, store.resources, store.viewport, updateResourcePosition, storeSetViewport);
    },
    [iOnMouseMove, store.resources, store.viewport, updateResourcePosition, storeSetViewport],
  );
  const onMouseUp = useCallback(
    () => iOnMouseUp(commitCurrentState),
    [iOnMouseUp, commitCurrentState],
  );
  const onWheelZoom = useCallback(
    (e: WheelEvent) => iOnWheelZoom(e, getViewport(), storeSetViewport),
    [iOnWheelZoom, getViewport, storeSetViewport],
  );

  const onNodeMouseDown = useCallback(
    (e: React.MouseEvent, resource: ResourceInstance) => {
      iOnNodeMouseDown(e, resource, store.viewport, store.mode, store.resources, storeConnect);
      // Selecting is meaningful in move mode; in connect mode the click drives
      // wiring but selecting the node is still useful feedback.
      storeSetSelection({ type: "node", id: resource.id, resource });
    },
    [
      iOnNodeMouseDown,
      store.viewport,
      store.mode,
      store.resources,
      storeConnect,
      storeSetSelection,
    ],
  );

  // Stable connect callback: its identity only changes when resources/connect
  // change, NOT on viewport changes. This lets the renderer's viewport-only
  // fast path (which compares callback references) actually short-circuit on
  // pan/zoom instead of running a full structural diff every frame.
  const onConnectCb = useCallback(
    (id: string, type: "start" | "end") => {
      iOnConnect(id, type, store.resources, storeConnect);
    },
    [iOnConnect, store.resources, storeConnect],
  );

  const draw = useCallback(() => {
    rDraw(
      store.resources,
      store.relationships,
      store.viewport,
      store.selection,
      onNodeMouseDown,
      onConnectCb,
      storeSetSelection,
    );
  }, [
    rDraw,
    store.resources,
    store.relationships,
    store.viewport,
    store.selection,
    onNodeMouseDown,
    onConnectCb,
    storeSetSelection,
  ]);
  const drawMinimap = useCallback(
    () => rDrawMinimap(store.resources),
    [rDrawMinimap, store.resources],
  );
  const fitToView = useCallback(
    () => iFitToView(store.resources, worldRef, storeSetViewport),
    [iFitToView, store.resources, storeSetViewport],
  );
  const center = useCallback(
    () => iCenter(store.viewport, storeSetViewport),
    [iCenter, store.viewport, storeSetViewport],
  );

  /** Canvas-wrap pixel size (falls back to the window if not yet mounted). */
  const viewSize = useCallback(() => {
    const el = worldRef.current?.parentElement as HTMLElement | null;
    const r = el?.getBoundingClientRect();
    return { width: r?.width ?? window.innerWidth, height: r?.height ?? window.innerHeight };
  }, []);

  /** Zoom about the viewport centre by a multiplicative factor. */
  const zoomBy = useCallback(
    (factor: number) => {
      const v = viewSize();
      storeSetViewport(zoomByFactor(getViewport(), { x: v.width / 2, y: v.height / 2 }, factor));
    },
    [viewSize, getViewport, storeSetViewport],
  );
  const zoomIn = useCallback(() => zoomBy(1.2), [zoomBy]);
  const zoomOut = useCallback(() => zoomBy(1 / 1.2), [zoomBy]);

  /** Reset to 100% (scale 1) keeping the viewport centre fixed. */
  const zoomReset = useCallback(() => {
    const v = viewSize();
    storeSetViewport(zoomAbout(getViewport(), { x: v.width / 2, y: v.height / 2 }, 1));
  }, [viewSize, getViewport, storeSetViewport]);

  /** Frame the current selection (falls back to fit-all when nothing is selected). */
  const zoomToSelection = useCallback(() => {
    const ids = store.selectedIds.length
      ? store.selectedIds
      : store.selection?.type === "node"
        ? [store.selection.id]
        : [];
    if (ids.length === 0) {
      iFitToView(store.resources, worldRef, storeSetViewport);
      return;
    }
    const idSet = new Set(ids);
    const boxes: Rect[] = store.resources
      .filter((r) => idSet.has(r.id))
      .map((r) => r.position ?? { x: 0, y: 0, ...DEFAULT_NODE_SIZE });
    const bounds = boundsOf(boxes);
    if (!bounds) return;
    storeSetViewport(fitView(bounds, viewSize(), { maxScale: 1.4 }));
  }, [store.selectedIds, store.selection, store.resources, iFitToView, storeSetViewport, viewSize]);

  // ---- Validation + rule suggestions -------------------------------------
  // Expose STRUCTURED results; the Inspector renders them as React elements
  // (no raw HTML / dangerouslySetInnerHTML).
  const runValidate = useCallback(() => {
    setValidationResults(validateArchitecture(buildGraph()));
  }, [buildGraph]);

  const runSuggest = useCallback(() => {
    setRuleSuggestions(suggestRulesEngine(buildGraph()));
  }, [buildGraph]);

  // ---- Export / Import ----------------------------------------------------
  const exportJSON = () => {
    const graph = buildGraph();
    const blob = new Blob([JSON.stringify(graph, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "aws-architecture.json";
    a.click();
  };

  const importJSONDialog = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onerror = () => setStatus("Import failed: could not read file.");
      reader.onload = () => {
        try {
          const parsed = JSON.parse(String(reader.result)) as unknown;
          if (typeof parsed !== "object" || parsed === null) {
            throw new Error("not an object");
          }
          const g = parsed as Partial<InfrastructureGraph>;
          if (!Array.isArray(g.resources)) {
            throw new Error("missing resources array");
          }
          store.replaceAll({
            resources: g.resources ?? [],
            relationships: g.relationships ?? [],
            viewport: g.viewport,
            accounts: g.accounts ?? [],
            graphId: g.id ?? "",
          });
          setStatus(`Imported "${g.name ?? "architecture"}".`);
        } catch {
          // Swallow the underlying parse/validation detail to avoid surfacing
          // internal error text to the user.
          setStatus("Import failed: not a valid architecture file.");
        }
      };
      reader.readAsText(file);
    };
    input.click();
  };

  const importIaCDialog = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,.yaml,.yml,.tf,.tfstate,.template";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onerror = () => setStatus("Import failed: could not read file.");
      reader.onload = () => {
        try {
          const text = String(reader.result);
          const result = importIaC(text, { name: file.name });
          const { graph, format, unmappedTypes, warnings } = result;
          store.replaceAll({
            resources: graph.resources ?? [],
            relationships: graph.relationships ?? [],
            viewport: graph.viewport,
            accounts: graph.accounts ?? [],
            graphId: graph.id ?? "",
          });
          store.setSelection(null);
          const parts = [`Imported ${graph.resources.length} resource(s) from ${format}.`];
          if (unmappedTypes.length > 0) {
            parts.push(`Unmapped types: ${unmappedTypes.join(", ")}.`);
          }
          if (warnings.length > 0) {
            parts.push(warnings.join(" "));
          }
          setStatus(parts.join(" "));
        } catch (err) {
          const detail = err instanceof Error ? err.message : "unknown error";
          setStatus(`IaC import failed: ${detail}`);
        }
      };
      reader.readAsText(file);
    };
    input.click();
  };

  // ---- Server save / load -------------------------------------------------
  const saveToServer = useCallback(async () => {
    try {
      setStatus("Saving to server…");
      const graph = buildGraph();
      const saved = store.graphId
        ? await updateGraph(store.graphId, graph)
        : await createGraph(graph);
      store.setGraphId(saved.id);
      setStatus(`Saved "${saved.name}" (${saved.id}).`);
    } catch {
      setStatus("Save failed: API unavailable.");
    }
  }, [buildGraph, store]);

  const loadFromServer = useCallback(async () => {
    try {
      setStatus("Loading from server…");
      const summaries = await listGraphs();
      if (summaries.length === 0) {
        setStatus("No saved graphs on server.");
        return;
      }
      const list = summaries
        .map((s, i) => `${i + 1}. ${s.name} (${s.resourceCount} resources)`)
        .join("\n");
      const pick = typeof prompt === "function" ? prompt(`Load which graph?\n${list}`, "1") : "1";
      if (!pick) {
        setStatus("Load cancelled.");
        return;
      }
      const idx = Math.max(1, Math.min(summaries.length, Number(pick))) - 1;
      const g = await getGraph(summaries[idx].id);
      store.replaceAll({
        resources: g.resources ?? [],
        relationships: g.relationships ?? [],
        viewport: g.viewport,
        accounts: g.accounts ?? [],
        graphId: g.id,
      });
      setStatus(`Loaded "${g.name}".`);
    } catch {
      setStatus("Load failed: API unavailable.");
    }
  }, [store]);

  // ---- Presets ------------------------------------------------------------
  const loadPreset = (presetName: string) => {
    const resources: ResourceInstance[] = [];
    const relationships: Relationship[] = [];
    const seed = (
      serviceId: string,
      x: number,
      y: number,
      name: string,
      config: Record<string, unknown> = {},
    ) => {
      const id = store.uid();
      const svc = getService(serviceId);
      resources.push({
        id,
        serviceId,
        name: name || svc?.name || serviceId,
        config: { ...defaultConfig(serviceId), ...config },
        source: "manual",
        position: { x, y, ...DEFAULT_NODE_SIZE },
      });
      return id;
    };
    const link = (from: string, to: string, kind: RelationshipKind) => {
      relationships.push({ id: store.uid(), from, to, kind, source: "manual" });
    };

    if (presetName === "aws-basic") {
      const vpc = seed("vpc", 80, 120, "VPC", { cidr: "10.0.0.0/16" });
      const pubA = seed("subnet-public", 140, 220, "Public A", {
        cidr: "10.0.1.0/24",
        az: "us-east-1a",
      });
      const priA = seed("subnet-private", 140, 360, "Private A", {
        cidr: "10.0.2.0/24",
        az: "us-east-1a",
      });
      const igw = seed("internet-gateway", 420, 180, "IGW");
      link(vpc, pubA, "contains");
      link(vpc, priA, "contains");
      link(igw, vpc, "attached_to");
    } else if (presetName === "ecs-alb") {
      const vpc = seed("vpc", 80, 120, "VPC", { cidr: "10.0.0.0/16" });
      const pubA = seed("subnet-public", 140, 220, "Public A", {
        cidr: "10.0.1.0/24",
        az: "us-east-1a",
      });
      const priA = seed("subnet-private", 140, 360, "Private A", {
        cidr: "10.0.2.0/24",
        az: "us-east-1a",
      });
      const igw = seed("internet-gateway", 420, 180, "IGW");
      const nat = seed("nat-gateway", 420, 260, "NAT GW");
      const rtPub = seed("route-table", 390, 220, "RT Public");
      const rtPri = seed("route-table", 390, 340, "RT Private");
      const nacl = seed("nacl", 390, 420, "App NACL");
      const alb = seed("elastic-load-balancer", 700, 200, "ALB");
      const sgAlb = seed("security-group", 620, 140, "SG-ALB");
      const ecs = seed("ecs-service", 820, 340, "App Service", { port: 3000 });
      const sgApp = seed("security-group", 760, 300, "SG-App");
      const tg = seed("target-group", 760, 240, "TG-App", { port: 3000 });

      link(vpc, pubA, "contains");
      link(vpc, priA, "contains");
      link(igw, vpc, "attached_to");
      link(nat, pubA, "attached_to");
      link(rtPub, pubA, "attached_to");
      link(rtPri, priA, "attached_to");
      link(rtPub, igw, "routes_to");
      link(rtPri, nat, "routes_to");
      link(nacl, priA, "attached_to");
      link(alb, pubA, "attached_to");
      link(sgAlb, alb, "attached_to");
      link(alb, tg, "targets");
      link(tg, ecs, "targets");
      link(sgApp, ecs, "attached_to");
    } else {
      return;
    }

    store.replaceAll({
      resources,
      relationships,
      viewport: { x: 200, y: 120, scale: 1 },
      accounts: [],
      graphId: "",
    });
  };

  const value: FlowContextValue = {
    state,
    worldRef,
    svgRef,
    minimapRef,
    selection: store.selection,

    setMode: store.setMode,
    toggleMode,
    select: store.setSelection,
    addResourceFromPalette,
    removeSelection: store.removeSelection,
    duplicateSelection: store.duplicateSelection,
    groupIntoVPC: store.groupIntoVPC,
    updateResourceField,
    updateRelationshipKind,

    onCanvasMouseDown: interaction.onCanvasMouseDown,
    onCanvasClick: () => store.setSelection(null),
    onMouseMove,
    onMouseUp,
    onWheelZoom,
    setSpacePressed: interaction.setSpacePressed,

    draw,
    drawMinimap,
    fitToView,
    center,
    zoomIn,
    zoomOut,
    zoomReset,
    zoomToSelection,

    undo: store.undo,
    redo: store.redo,
    canUndo: store.canUndo(),
    canRedo: store.canRedo(),

    validate: runValidate,
    suggestRules: runSuggest,
    exportJSON,
    importJSONDialog,
    importIaCDialog,
    clear: store.clear,
    loadPreset,
    runValidateUI: runValidate,
    runRulesUI: runSuggest,
    saveToServer,
    loadFromServer,
    validationResults,
    ruleSuggestions,
    status,
  };

  return <FlowContext.Provider value={value}>{children}</FlowContext.Provider>;
};
