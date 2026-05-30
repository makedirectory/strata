"use client";
import React, { createContext, useContext, useRef, useCallback, useEffect } from "react";
import { useFlowStore } from "./useFlowStore";
import { useCanvasInteraction } from "./useCanvasInteraction";
import { useCanvasRenderer } from "./useCanvasRenderer";
import type { ResourceInstance, Relationship, InfrastructureGraph } from "../aws/model";
import { emptyGraph, DEFAULT_NODE_SIZE } from "../aws/model";
import type { CanvasMode, CanvasDensity, Selection } from "../types";
import type { RelationshipKind } from "../aws/types";
import { defaultConfig, getService } from "../aws/registry";
import {
  validateArchitecture,
  suggestRules as suggestRulesEngine,
  type ValidationResult,
  type RuleSuggestion,
} from "../aws/rules";
import { listGraphs, getGraph, createGraph, updateGraph, deleteGraph } from "../lib/api";
import type { GraphSummary } from "../aws/model";
import { importIaC } from "../aws/iac";
import {
  zoomAbout,
  zoomByFactor,
  fitView,
  boundsOf,
  viewportWorldRect,
  minimapTransform,
  minimapToWorld,
  panToCenter,
  type Rect,
  type GuideLine,
} from "../canvas/geometry";

interface FlowContextValue {
  state: {
    resources: ResourceInstance[];
    relationships: Relationship[];
    viewport: ReturnType<typeof useFlowStore>["viewport"];
    mode: CanvasMode;
    density: CanvasDensity;
  };
  worldRef: React.RefObject<HTMLDivElement | null>;
  svgRef: React.RefObject<SVGSVGElement | null>;
  minimapRef: React.RefObject<HTMLCanvasElement | null>;
  selection: Selection;
  /** Ids of all selected nodes (single or marquee/group multi-selection). */
  selectedIds: string[];
  /** Transient alignment guides (world coords) to draw while dragging. */
  guides: GuideLine[];
  /** Transient marquee selection rectangle (world coords), or null. */
  marquee: Rect | null;

  // Actions
  setMode: (m: CanvasMode) => void;
  toggleMode: () => void;
  setDensity: (d: CanvasDensity) => void;
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
  /** Centre the viewport on the world point under a minimap client pixel. */
  minimapNavigate: (clientX: number, clientY: number) => void;

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
  /** List saved graphs for the Load menu. */
  listSavedGraphs: () => Promise<GraphSummary[]>;
  /** Load a saved graph by id. */
  loadGraph: (id: string) => Promise<void>;
  /** Delete a saved graph by id. */
  deleteSavedGraph: (id: string) => Promise<void>;
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
    onCanvasMouseDown: iOnCanvasMouseDown,
    onConnect: iOnConnect,
    fitToView: iFitToView,
    center: iCenter,
  } = interaction;
  const { draw: rDraw, drawMinimap: rDrawMinimap } = renderer;

  const [validationResults, setValidationResults] = React.useState<ValidationResult[] | null>(null);
  const [ruleSuggestions, setRuleSuggestions] = React.useState<RuleSuggestion[] | null>(null);
  const [status, setStatus] = React.useState<string>(
    "Scroll to pan · ⌘/pinch to zoom · drag empty canvas to select · Space+drag to pan · C to connect.",
  );
  // Transient alignment guides shown while dragging a node (world coordinates).
  const [guides, setGuides] = React.useState<GuideLine[]>([]);

  const state = {
    resources: store.resources,
    relationships: store.relationships,
    viewport: store.viewport,
    mode: store.mode,
    density: store.density,
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
    updateResourcePositions,
    setViewport: storeSetViewport,
    getViewport,
    commitCurrentState,
    setSelection: storeSetSelection,
    setSelectedIds: storeSetSelectedIds,
    connect: storeConnect,
  } = store;

  // ---- selection helpers (single + multi kept consistent) ----------------
  const selectSingle = useCallback(
    (id: string) => {
      const r = store.resources.find((x) => x.id === id);
      storeSetSelectedIds([id]);
      if (r) storeSetSelection({ type: "node", id, resource: r });
    },
    [store.resources, storeSetSelectedIds, storeSetSelection],
  );
  const clearSelection = useCallback(() => {
    storeSetSelectedIds([]);
    storeSetSelection(null);
  }, [storeSetSelectedIds, storeSetSelection]);
  /** Apply a marquee result: 0 → clear, 1 → single (Inspector detail), N → multi. */
  const applyMarquee = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) {
        clearSelection();
      } else if (ids.length === 1) {
        selectSingle(ids[0]);
      } else {
        storeSetSelectedIds(ids);
        storeSetSelection(null);
      }
    },
    [clearSelection, selectSingle, storeSetSelectedIds, storeSetSelection],
  );

  // Transient marquee selection rectangle (world coords) drawn while dragging.
  const [marquee, setMarquee] = React.useState<Rect | null>(null);

  // Hovered node id → drives focus-dimming. Deduped so repeated enters of the
  // same node don't re-render.
  const [hoverId, setHoverId] = React.useState<string | null>(null);
  const onHover = useCallback((id: string | null) => {
    setHoverId((prev) => (prev === id ? prev : id));
  }, []);
  // Focus = the hovered node, else the single selected node. Its 1-hop
  // neighbourhood stays lit; everything else dims.
  const focusId = hoverId ?? (store.selection?.type === "node" ? store.selection.id : null);

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

  const onCanvasMouseDown = useCallback(
    (e: React.MouseEvent) => {
      iOnCanvasMouseDown(e, {
        pan: store.viewport,
        mode: store.mode,
        setMarquee,
        clearSelection,
      });
    },
    [iOnCanvasMouseDown, store.viewport, store.mode, clearSelection],
  );
  const onMouseMove = useCallback(
    (e: MouseEvent) => {
      iOnMouseMove(e, {
        resources: store.resources,
        pan: store.viewport,
        updatePositions: updateResourcePositions,
        updatePan: storeSetViewport,
        setGuides,
        setMarquee,
      });
    },
    [iOnMouseMove, store.resources, store.viewport, updateResourcePositions, storeSetViewport],
  );
  const onMouseUp = useCallback(() => {
    iOnMouseUp({
      resources: store.resources,
      commitState: commitCurrentState,
      selectSingle,
      applyMarquee,
      clearSelection,
      setGuides,
      setMarquee,
    });
  }, [iOnMouseUp, store.resources, commitCurrentState, selectSingle, applyMarquee, clearSelection]);
  const onWheelZoom = useCallback(
    (e: WheelEvent) => iOnWheelZoom(e, getViewport(), storeSetViewport),
    [iOnWheelZoom, getViewport, storeSetViewport],
  );

  const onNodeMouseDown = useCallback(
    (e: React.MouseEvent, resource: ResourceInstance) => {
      // Selection is decided inside the interaction layer (selectSingle): a node
      // in a multi-selection keeps the group for dragging; any other node
      // becomes the single selection.
      iOnNodeMouseDown(e, resource, {
        pan: store.viewport,
        mode: store.mode,
        resources: store.resources,
        selectedIds: store.selectedIds,
        connect: storeConnect,
        selectSingle,
      });
    },
    [
      iOnNodeMouseDown,
      store.viewport,
      store.mode,
      store.resources,
      store.selectedIds,
      storeConnect,
      selectSingle,
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

  /** Canvas-wrap pixel size (falls back to the window if not yet mounted). */
  const viewSize = useCallback(() => {
    const el = worldRef.current?.parentElement as HTMLElement | null;
    const r = el?.getBoundingClientRect();
    return { width: r?.width ?? window.innerWidth, height: r?.height ?? window.innerHeight };
  }, []);

  const draw = useCallback(() => {
    rDraw(
      store.resources,
      store.relationships,
      store.viewport,
      store.selection,
      store.selectedIds,
      store.density,
      focusId,
      onNodeMouseDown,
      onConnectCb,
      storeSetSelection,
      onHover,
    );
  }, [
    rDraw,
    store.resources,
    store.relationships,
    store.viewport,
    store.selection,
    store.selectedIds,
    store.density,
    focusId,
    onNodeMouseDown,
    onConnectCb,
    storeSetSelection,
    onHover,
  ]);
  const drawMinimap = useCallback(
    () => rDrawMinimap(store.resources, store.viewport, viewSize()),
    [rDrawMinimap, store.resources, store.viewport, viewSize],
  );
  const fitToView = useCallback(
    () => iFitToView(store.resources, worldRef, storeSetViewport),
    [iFitToView, store.resources, storeSetViewport],
  );
  const center = useCallback(
    () => iCenter(store.viewport, storeSetViewport),
    [iCenter, store.viewport, storeSetViewport],
  );

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

  /**
   * Centre the viewport on the world point under a minimap pixel (client
   * coords). Used by minimap click + drag-to-navigate. The minimap transform is
   * recomputed from the same inputs the renderer uses so clicks land precisely.
   */
  const minimapNavigate = useCallback(
    (clientX: number, clientY: number) => {
      const el = minimapRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const bw = el.width || 180;
      const bh = el.height || 120;
      // Map display pixels → canvas backing-store pixels (they match today, but
      // stay correct if the minimap is ever resized in CSS).
      const mx = (clientX - rect.left) * (bw / rect.width);
      const my = (clientY - rect.top) * (bh / rect.height);
      const vp = getViewport();
      const view = viewSize();
      const content = boundsOf(
        store.resources.map((r) => r.position ?? { x: 0, y: 0, ...DEFAULT_NODE_SIZE }),
      );
      const t = minimapTransform(content, viewportWorldRect(vp, view), { w: bw, h: bh });
      const world = minimapToWorld(t, { x: mx, y: my });
      storeSetViewport(panToCenter(world, view, vp.scale));
    },
    [minimapRef, getViewport, viewSize, store.resources, storeSetViewport],
  );

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

  /** List saved graphs for the Load menu (returns [] and reports on failure). */
  const listSavedGraphs = useCallback(async (): Promise<GraphSummary[]> => {
    try {
      return await listGraphs();
    } catch {
      setStatus("Load failed: API unavailable.");
      return [];
    }
  }, []);

  /** Load a saved graph by id (replaces the current model). */
  const loadGraph = useCallback(
    async (id: string) => {
      try {
        setStatus("Loading from server…");
        const g = await getGraph(id);
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
    },
    [store],
  );

  /** Delete a saved graph by id (clears graphId if it was the open one). */
  const deleteSavedGraph = useCallback(
    async (id: string) => {
      try {
        await deleteGraph(id);
        if (store.graphId === id) store.setGraphId("");
        setStatus("Deleted saved graph.");
      } catch {
        setStatus("Delete failed: API unavailable.");
      }
    },
    [store],
  );

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
    selectedIds: store.selectedIds,
    guides,
    marquee,

    setMode: store.setMode,
    toggleMode,
    setDensity: store.setDensity,
    select: store.setSelection,
    addResourceFromPalette,
    removeSelection: store.removeSelection,
    duplicateSelection: store.duplicateSelection,
    groupIntoVPC: store.groupIntoVPC,
    updateResourceField,
    updateRelationshipKind,

    onCanvasMouseDown,
    onCanvasClick: clearSelection,
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
    minimapNavigate,

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
    listSavedGraphs,
    loadGraph,
    deleteSavedGraph,
    validationResults,
    ruleSuggestions,
    status,
  };

  return <FlowContext.Provider value={value}>{children}</FlowContext.Provider>;
};
