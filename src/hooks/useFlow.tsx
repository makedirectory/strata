"use client";
import React, { createContext, useContext, useRef, useCallback, useEffect } from "react";
import { useFlowStore } from "./useFlowStore";
import { useCanvasInteraction } from "./useCanvasInteraction";
import { useCanvasRenderer } from "./useCanvasRenderer";
import type { ResourceInstance, Relationship, InfrastructureGraph } from "../aws/model";
import { emptyGraph, DEFAULT_NODE_SIZE } from "../aws/model";
import type { CanvasMode, CanvasDensity, Selection } from "../types";
import type { RelationshipKind } from "../aws/types";
import { defaultConfig, getService, serviceColor, serviceIcon } from "../aws/registry";
import { buildSvg } from "../canvas/imageExport";
import {
  validateArchitecture,
  suggestRules as suggestRulesEngine,
  type ValidationResult,
  type RuleSuggestion,
} from "../aws/rules";
// Saved diagrams persist in the browser (localStorage), not on the server: the
// hosted app runs on a read-only serverless filesystem. JSON export/import is
// the way to move a diagram between browsers.
import { listGraphs, getGraph, createGraph, updateGraph, deleteGraph } from "../lib/localStore";
import type { GraphSummary } from "../aws/model";
import { importAnyIaC } from "../lib/importIac";
import { getExample } from "../examples";
import { estimateMonthlyCost, estimateTotal, formatMonthly } from "../aws/cost";
import { buildShareUrl, readGraphFromHash } from "../lib/shareLink";
import {
  zoomAbout,
  zoomByFactor,
  fitView,
  boundsOf,
  viewportWorldRect,
  minimapTransform,
  minimapToWorld,
  panToCenter,
  expandRect,
  type Rect,
  type Vec2,
  type GuideLine,
} from "../canvas/geometry";
import { computeLayout, summaryKey, type LayoutResult } from "../canvas/layout";
import { arrangeTiered } from "../canvas/arrange";
import { RELATIONSHIP_CLASS_ORDER, type RelationshipClass } from "../aws/relationshipClasses";
import {
  iamTrustOverlay,
  securityPathOverlay,
  heatByDegree,
  heatColor,
  type OverlayKind,
  type OverlayLit,
} from "../aws/overlays";
import type { ServiceCategoryId } from "../aws/types";
import type { LayerState } from "./useFlowStore";

/** Above this many resources the renderer culls to the viewport. */
const CULL_THRESHOLD = 250;
/** Collapse this many same-type leaf children of a container into a summary. */
const SUMMARY_THRESHOLD = 5;

/** Built-in view-mode presets → relationship-class emphasis. */
export type ViewPreset = "all" | "network" | "security" | "data" | "high-level";

/** A user-saved view (layer state) persisted to localStorage. */
interface SavedView {
  name: string;
  hiddenCategories: string[];
  hiddenRelClasses: string[];
  filterMode: "dim" | "hide";
  environmentTint: boolean;
}
const SAVED_VIEWS_KEY = "strata.savedViews";

function readSavedViews(): SavedView[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(SAVED_VIEWS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as SavedView[]) : [];
  } catch {
    return [];
  }
}

/**
 * Canvas-only, high-churn slice — viewport + transient drag visuals + the
 * imperative draw / pointer handlers. Lives in its own context so panning,
 * zooming and hovering re-render ONLY the canvas, never the side panels.
 */
interface FlowCanvasContextValue {
  viewport: ReturnType<typeof useFlowStore>["viewport"];
  guides: GuideLine[];
  marquee: Rect | null;
  draw: () => void;
  drawMinimap: () => void;
  onCanvasMouseDown: (e: React.MouseEvent) => void;
  onMouseMove: (e: MouseEvent) => void;
  onMouseUp: () => void;
  onWheelZoom: (e: WheelEvent) => void;
  addResourceFromPalette: (serviceId: string, x: number, y: number) => void;
  minimapNavigate: (clientX: number, clientY: number) => void;
}

interface FlowContextValue {
  state: {
    resources: ResourceInstance[];
    relationships: Relationship[];
    mode: CanvasMode;
    density: CanvasDensity;
  };
  worldRef: React.RefObject<HTMLDivElement | null>;
  svgRef: React.RefObject<SVGSVGElement | null>;
  minimapRef: React.RefObject<HTMLCanvasElement | null>;
  selection: Selection;
  /** Ids of all selected nodes (single or marquee/group multi-selection). */
  selectedIds: string[];

  // Actions
  setMode: (m: CanvasMode) => void;
  toggleMode: () => void;
  setDensity: (d: CanvasDensity) => void;
  /** Focus a container (zoom-to-fit + dim others), or null to clear. */
  focusContainer: (id: string | null) => void;
  /** Double-click handler for a node id (toggles container focus). */
  onNodeDoubleClick: (id: string) => void;
  /** Select + centre on a node (⌘K jump / search). */
  goToResource: (id: string) => void;
  /** Setter for the live search-match highlight (read by the renderer only). */
  setSearchMatches: (ids: ReadonlySet<string>) => void;
  /** Ancestor path of the focus target, root → leaf (clickable crumbs). */
  breadcrumb: Array<{ id: string; name: string }>;
  /** Currently focused container id, or null. */
  focusedContainerId: string | null;

  // Layers / filters / overlays (Phase 3)
  hiddenCategories: ReadonlySet<string>;
  hiddenRelClasses: ReadonlySet<string>;
  filterMode: "dim" | "hide";
  environmentTint: boolean;
  edgeStyle: "curved" | "orthogonal";
  setEdgeStyle: (s: "curved" | "orthogonal") => void;
  /** Presentation / read-only mode (hides editing chrome, gates edits). */
  presentation: boolean;
  setPresentation: (on: boolean) => void;
  /** Active analytical overlay (Phase 6). */
  activeOverlay: OverlayKind;
  setActiveOverlay: (o: OverlayKind) => void;
  toggleCategory: (id: ServiceCategoryId) => void;
  toggleRelClass: (id: RelationshipClass) => void;
  setFilterMode: (m: "dim" | "hide") => void;
  setEnvironmentTint: (on: boolean) => void;
  applyViewPreset: (name: ViewPreset) => void;
  savedViews: ReadonlyArray<{ name: string }>;
  saveView: (name: string) => void;
  applySavedView: (name: string) => void;
  deleteSavedView: (name: string) => void;

  select: (sel: Selection) => void;
  removeSelection: () => void;
  duplicateSelection: () => void;
  groupIntoVPC: () => void;
  updateResourceField: (patch: {
    name?: string;
    region?: string;
    config?: Record<string, unknown>;
  }) => void;
  updateRelationshipKind: (kind: RelationshipKind) => void;

  // Canvas interaction / view controls (the high-frequency draw + pointer
  // handlers live in FlowCanvasContext, not here).
  onCanvasClick: () => void;
  setSpacePressed: (pressed: boolean) => void;
  fitToView: () => void;
  center: () => void;
  /** Auto-arrange top-level nodes into a tidy grid. */
  tidy: () => void;
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
  /** Download the diagram as a vector SVG or rasterised PNG image. */
  exportImage: (format: "svg" | "png") => void;
  /** Copy a self-contained share link (diagram encoded in the URL hash). */
  shareDiagram: () => void;
  importJSONDialog: () => void;
  importIaCDialog: () => void;
  clear: () => void;
  loadPreset: (presetName: string) => void;
  /** Load a bundled example architecture by id (guarded by the unsaved check). */
  loadExample: (exampleId: string) => void;
  /** Current diagram name (what a save persists). */
  graphName: string;
  /** Rename the current diagram. */
  renameGraph: (name: string) => void;

  // ---- Start hub + unsaved-work guard (Flow 2) ----
  /** True when there are unsaved changes a replace action would lose. */
  dirty: boolean;
  /** Whether the "Start a diagram" hub modal is open. */
  startHubOpen: boolean;
  openStartHub: () => void;
  closeStartHub: () => void;
  /** First-run guided tour. */
  tourOpen: boolean;
  tourStep: number;
  openTour: () => void;
  closeTour: () => void;
  setTourStep: (n: number) => void;
  /** Start a fresh blank diagram (guarded by the unsaved-work check). */
  startBlank: () => void;
  /** Whether the replace-confirmation dialog is showing. */
  replaceConfirmOpen: boolean;
  /** Resolve the pending replace confirmation. "save" persists first. */
  resolveReplaceConfirm: (choice: "save" | "discard" | "cancel") => void;

  // ---- Export to IaC (Flow 3) ----
  /** Whether the "Export to IaC" dialog is open. */
  exportIaCOpen: boolean;
  openExportIaC: () => void;
  closeExportIaC: () => void;
  /** Build the current model as an InfrastructureGraph (for the export dialog). */
  snapshotGraph: () => InfrastructureGraph;

  // ---- Live discovery / Connect to AWS (Flow 4) ----
  /** Whether the "Connect to AWS" discovery dialog is open. */
  connectOpen: boolean;
  openConnect: () => void;
  closeConnect: () => void;
  /** Apply a discovered graph: "merge" keeps current work, "replace" is guarded. */
  importDiscoveredGraph: (graph: InfrastructureGraph, mode: "merge" | "replace") => void;
  runValidateUI: () => void;
  runRulesUI: () => void;
  saveGraph: () => void;
  /** List saved graphs for the Load menu. */
  listSavedGraphs: () => Promise<GraphSummary[]>;
  /** Load a saved graph by id. */
  loadGraph: (id: string) => Promise<void>;
  /** Delete a saved graph by id. */
  deleteSavedGraph: (id: string) => Promise<void>;
  /** Structured validation findings, or `null` before the first run. */
  validationResults: ValidationResult[] | null;
  /** Always-on validation: live findings recomputed on every graph change. */
  liveFindings: ValidationResult[];
  /** Per-node finding markers (top-right corner) for the canvas overlay. */
  findingMarkers: { id: string; x: number; y: number; level: "error" | "warn" }[];
  /** Live error/warn counts for the validation summary badge. */
  findingCounts: { error: number; warn: number };
  /** Cost overlay: per-node $/mo labels + a diagram total (rough estimate). */
  showCost: boolean;
  toggleCost: () => void;
  costSummary: { total: number; estimated: number; unknown: number; label: string };
  costMarkers: { id: string; x: number; y: number; text: string }[];
  /** Structured rule suggestions, or `null` before the first run. */
  ruleSuggestions: RuleSuggestion[] | null;
  status: string;
}

const FlowContext = createContext<FlowContextValue | null>(null);
const FlowCanvasContext = createContext<FlowCanvasContextValue | null>(null);

/** Access the Flow context. Throws if used outside a {@link FlowProvider}. */
export const useFlow = (): FlowContextValue => {
  const ctx = useContext(FlowContext);
  if (ctx === null) {
    throw new Error("useFlow must be used within a <FlowProvider>.");
  }
  return ctx;
};

/** Access the Canvas-only context (viewport + draw/pointer handlers). */
export const useFlowCanvas = (): FlowCanvasContextValue => {
  const ctx = useContext(FlowCanvasContext);
  if (ctx === null) {
    throw new Error("useFlowCanvas must be used within a <FlowProvider>.");
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

  // Stable store methods pulled out as locals. Callbacks that *call* these must
  // depend on the local (not `store.x`) — otherwise eslint demands the whole
  // `store` object, which changes every render and would defeat the memoized
  // context (re-rendering panels on every pan/hover).
  const {
    getViewport,
    replaceAll: storeReplaceAll,
    setGraphId: storeSetGraphId,
    uid: storeUid,
    setCollapsedIds,
    expandGroup,
    setFocusedContainerId,
    clear: storeClear,
    markSaved: storeMarkSaved,
    mergeGraph: storeMergeGraph,
  } = store;

  // Destructure the stable (useCallback) members so handler deps below stay
  // referentially stable across renders.
  const {
    screenToWorld,
    onMouseMove: iOnMouseMove,
    onMouseUp: iOnMouseUp,
    onWheelZoom: iOnWheelZoom,
    onNodeMouseDown: iOnNodeMouseDown,
    onResizeStart: iOnResizeStart,
    onCanvasMouseDown: iOnCanvasMouseDown,
    onConnect: iOnConnect,
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

  // ---- Start hub + unsaved-work guard (Flow 2) --------------------------
  const [startHubOpen, setStartHubOpen] = React.useState(false);
  const [replaceConfirmOpen, setReplaceConfirmOpen] = React.useState(false);
  // Resolver for the in-flight confirmReplaceIfDirty() promise.
  const replaceResolverRef = useRef<((proceed: boolean) => void) | null>(null);
  const openStartHub = useCallback(() => setStartHubOpen(true), []);
  const closeStartHub = useCallback(() => setStartHubOpen(false), []);

  // ---- First-run guided tour --------------------------------------------
  const ONBOARDED_KEY = "strata.onboarded";
  const [tourOpen, setTourOpen] = React.useState(false);
  const [tourStep, setTourStep] = React.useState(0);
  const openTour = useCallback(() => {
    setTourStep(0);
    setTourOpen(true);
  }, []);
  const closeTour = useCallback(() => {
    setTourOpen(false);
    try {
      localStorage.setItem(ONBOARDED_KEY, "1");
    } catch {
      /* localStorage unavailable (private mode) — tour just shows again next time */
    }
  }, []);
  const setTourStepClamped = useCallback((n: number) => setTourStep(Math.max(0, n)), []);

  const [exportIaCOpen, setExportIaCOpen] = React.useState(false);
  const openExportIaC = useCallback(() => setExportIaCOpen(true), []);
  const closeExportIaC = useCallback(() => setExportIaCOpen(false), []);

  const [connectOpen, setConnectOpen] = React.useState(false);
  const openConnect = useCallback(() => setConnectOpen(true), []);
  const closeConnect = useCallback(() => setConnectOpen(false), []);

  /**
   * Gate any graph-replacing action behind an unsaved-work check. Resolves
   * `true` immediately when there is nothing to lose; otherwise opens the
   * confirm dialog and resolves once the user chooses (true = proceed).
   */
  const confirmReplaceIfDirty = useCallback((): Promise<boolean> => {
    if (!store.dirty || store.resources.length === 0) return Promise.resolve(true);
    // If a confirm is already pending, resolve the superseded one as "canceled"
    // before opening a new dialog — otherwise its awaiter hangs forever once
    // this overwrites the resolver ref.
    if (replaceResolverRef.current) {
      replaceResolverRef.current(false);
      replaceResolverRef.current = null;
    }
    return new Promise<boolean>((resolve) => {
      replaceResolverRef.current = resolve;
      setReplaceConfirmOpen(true);
    });
  }, [store.dirty, store.resources.length]);

  /** Apply a graph built from discovered resources. "merge" preserves current
   *  work; "replace" goes through the unsaved-work guard. */
  const importDiscoveredGraph = useCallback(
    async (graph: InfrastructureGraph, mode: "merge" | "replace") => {
      if (mode === "replace") {
        if (!(await confirmReplaceIfDirty())) return;
        storeReplaceAll({
          resources: graph.resources,
          relationships: graph.relationships,
          accounts: graph.accounts ?? [],
          graphId: "",
        });
      } else {
        storeMergeGraph({ resources: graph.resources, relationships: graph.relationships });
      }
      setConnectOpen(false);
      setStatus(`Imported ${graph.resources.length} discovered resource(s) (${mode}).`);
    },
    [confirmReplaceIfDirty, storeReplaceAll, storeMergeGraph],
  );

  // `viewport` is intentionally NOT here — it lives in the Canvas-only context
  // so panels don't re-render on pan/zoom.
  const state = React.useMemo(
    () => ({
      resources: store.resources,
      relationships: store.relationships,
      mode: store.mode,
      density: store.density,
    }),
    [store.resources, store.relationships, store.mode, store.density],
  );

  // ---- containment layout -------------------------------------------------
  const isContainerPred = useCallback(
    (r: ResourceInstance) => !!getService(r.serviceId)?.isContainer,
    [],
  );
  // Effective rects for every visible node (containers auto-fit + pack their
  // children; collapsed ones hide descendants; the live drag override detaches
  // a subtree to the cursor). The renderer, edges and hit-testing all read this.
  const layout: LayoutResult = React.useMemo(
    () =>
      computeLayout(store.resources, {
        collapsed: store.collapsed,
        isContainer: isContainerPred,
        density: store.density,
        override: store.dragOverride,
        summarize: { threshold: SUMMARY_THRESHOLD, expandedGroups: store.expandedGroups },
      }),
    [
      store.resources,
      store.collapsed,
      store.density,
      store.dragOverride,
      store.expandedGroups,
      isContainerPred,
    ],
  );

  // ---- always-on validation ----------------------------------------------
  // Findings recompute whenever the graph changes (validateArchitecture only
  // reads resources + relationships), so badges and the summary stay live.
  const liveFindings = React.useMemo<ValidationResult[]>(
    () =>
      validateArchitecture({
        resources: store.resources,
        relationships: store.relationships,
      } as InfrastructureGraph),
    [store.resources, store.relationships],
  );
  // Max severity per resource id (error beats warn), for node badging.
  const findingLevelById = React.useMemo(() => {
    const m = new Map<string, "error" | "warn">();
    for (const f of liveFindings) {
      if (!f.resourceId || f.level === "ok") continue;
      if (f.level === "error" || !m.has(f.resourceId)) m.set(f.resourceId, f.level);
    }
    return m;
  }, [liveFindings]);
  // Marker dots positioned at each flagged, visible node's top-right corner —
  // drawn by the Canvas as an SVG overlay (no imperative-renderer change).
  const findingMarkers = React.useMemo(() => {
    const out: { id: string; x: number; y: number; level: "error" | "warn" }[] = [];
    for (const [id, level] of findingLevelById) {
      const r = layout.rects.get(id);
      if (r) out.push({ id, x: r.x + r.w, y: r.y, level });
    }
    return out;
  }, [findingLevelById, layout]);
  const findingCounts = React.useMemo(() => {
    let error = 0;
    let warn = 0;
    for (const f of liveFindings) {
      if (f.level === "error") error++;
      else if (f.level === "warn") warn++;
    }
    return { error, warn };
  }, [liveFindings]);

  // ---- cost estimate overlay ---------------------------------------------
  const [showCost, setShowCost] = React.useState(false);
  const toggleCost = useCallback(() => setShowCost((v) => !v), []);
  const costSummary = React.useMemo(() => {
    const { total, estimated, unknown } = estimateTotal(store.resources);
    return { total, estimated, unknown, label: formatMonthly(total) };
  }, [store.resources]);
  // Per-node $/mo labels (bottom-right corner) shown only while the overlay is on.
  const costMarkers = React.useMemo(() => {
    if (!showCost) return [];
    const out: { id: string; x: number; y: number; text: string }[] = [];
    for (const r of store.resources) {
      const rect = layout.rects.get(r.id);
      if (!rect) continue;
      const c = estimateMonthlyCost(r);
      if (c === null || c === 0) continue;
      out.push({ id: r.id, x: rect.x + rect.w, y: rect.y + rect.h, text: formatMonthly(c) });
    }
    return out;
  }, [showCost, store.resources, layout]);

  // Environment-tint overlay: resource id → tint colour, from its account's
  // environment (or an Environment tag), null when the overlay is off.
  const envTintById = React.useMemo<ReadonlyMap<string, string> | null>(() => {
    if (!store.environmentTint) return null;
    const accById = new Map(store.accounts.map((a) => [a.id, a]));
    const tint = (env: string | undefined, accountColor?: string): string => {
      if (accountColor) return accountColor;
      const e = (env ?? "").toLowerCase();
      if (e.includes("prod")) return "#f87171";
      if (e.includes("stag")) return "#fbbf24";
      if (e.includes("dev")) return "#34d399";
      if (e.includes("sand") || e.includes("test")) return "#60a5fa";
      return "#94a3b8";
    };
    const m = new Map<string, string>();
    for (const r of store.resources) {
      const acc = r.accountId ? accById.get(r.accountId) : undefined;
      const env = acc?.environment ?? r.tags?.Environment ?? r.tags?.environment;
      if (acc || env) m.set(r.id, tint(env, acc?.color));
    }
    return m;
  }, [store.environmentTint, store.accounts, store.resources]);

  // ---- analytical overlays (Phase 6) -------------------------------------
  // Lit node/edge set for the IAM-trust or security-path overlay (selection-
  // aware); null for none/heat (which don't dim).
  const overlayLit = React.useMemo<OverlayLit | null>(() => {
    const focus = store.selection?.type === "node" ? store.selection.id : null;
    if (store.activeOverlay === "iam")
      return iamTrustOverlay(store.resources, store.relationships, focus);
    if (store.activeOverlay === "security")
      return securityPathOverlay(store.resources, store.relationships, focus);
    return null;
  }, [store.activeOverlay, store.resources, store.relationships, store.selection]);
  // Heat overlay tint map (degree proxy), reusing the background-tint channel.
  const overlayHeat = React.useMemo<ReadonlyMap<string, string> | null>(() => {
    if (store.activeOverlay !== "heat") return null;
    const heat = heatByDegree(store.resources, store.relationships);
    const m = new Map<string, string>();
    for (const [id, t] of heat) m.set(id, heatColor(t));
    return m;
  }, [store.activeOverlay, store.resources, store.relationships]);

  // Id set of the focused container's subtree (for focus-container dimming).
  const focusSubtree = React.useMemo<ReadonlySet<string> | null>(() => {
    const root = store.focusedContainerId;
    if (!root) return null;
    const childrenByParent = new Map<string, string[]>();
    for (const r of store.resources) {
      if (!r.parentId) continue;
      const list = childrenByParent.get(r.parentId);
      if (list) list.push(r.id);
      else childrenByParent.set(r.parentId, [r.id]);
    }
    const set = new Set<string>();
    const stack = [root];
    while (stack.length) {
      const id = stack.pop()!;
      if (set.has(id)) continue;
      set.add(id);
      for (const c of childrenByParent.get(id) ?? []) stack.push(c);
    }
    return set;
  }, [store.focusedContainerId, store.resources]);

  /** Deepest visible container under a world point, excluding a node's subtree
   *  (so a container can't be dropped into itself). Used for drag-to-reparent. */
  const containerAt = useCallback(
    (point: Vec2, excludeId: string): string | null => {
      // Build the excluded subtree (excludeId + all descendants).
      const desc = new Set<string>([excludeId]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const r of store.resources) {
          if (r.parentId && desc.has(r.parentId) && !desc.has(r.id)) {
            desc.add(r.id);
            grew = true;
          }
        }
      }
      let best: { id: string; depth: number } | null = null;
      for (const [id, rect] of layout.rects) {
        if (desc.has(id) || !layout.isContainerNode(id)) continue;
        const inside =
          point.x >= rect.x &&
          point.x <= rect.x + rect.w &&
          point.y >= rect.y &&
          point.y <= rect.y + rect.h;
        if (!inside) continue;
        const d = layout.depth.get(id) ?? 0;
        if (!best || d > best.depth) best = { id, depth: d };
      }
      return best?.id ?? null;
    },
    [store.resources, layout],
  );

  /** Assemble the current model into an InfrastructureGraph. */
  const buildGraph = useCallback((): InfrastructureGraph => {
    const base = emptyGraph(store.graphName || "Untitled diagram");
    return {
      ...base,
      id: store.graphId || "",
      accounts: store.accounts,
      resources: store.resources,
      relationships: store.relationships,
      // Read the live viewport so buildGraph (export/save) stays referentially
      // stable across pans — keeps the panel context from re-rendering.
      viewport: getViewport(),
    };
  }, [
    store.graphId,
    store.graphName,
    store.accounts,
    store.resources,
    store.relationships,
    getViewport,
  ]);

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
        readOnly: store.presentation,
        setMarquee,
        clearSelection,
      });
    },
    [iOnCanvasMouseDown, store.viewport, store.mode, store.presentation, clearSelection],
  );
  const onMouseMove = useCallback(
    (e: MouseEvent) => {
      iOnMouseMove(e, {
        rects: layout.rects,
        pan: store.viewport,
        updatePositions: updateResourcePositions,
        updateSize: store.updateResourceSize,
        updatePan: storeSetViewport,
        setGuides,
        setMarquee,
        setOverride: store.setDragOverride,
      });
    },
    [
      iOnMouseMove,
      layout,
      store.viewport,
      updateResourcePositions,
      store.updateResourceSize,
      storeSetViewport,
      store.setDragOverride,
    ],
  );
  const onMouseUp = useCallback(() => {
    iOnMouseUp({
      rects: layout.rects,
      commitState: commitCurrentState,
      selectSingle,
      applyMarquee,
      clearSelection,
      setGuides,
      setMarquee,
      setOverride: store.setDragOverride,
      containerAt,
      setParent: store.setParent,
    });
  }, [
    iOnMouseUp,
    layout,
    commitCurrentState,
    selectSingle,
    applyMarquee,
    clearSelection,
    store.setDragOverride,
    containerAt,
    store.setParent,
  ]);
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
        rects: layout.rects,
        readOnly: store.presentation,
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
      layout,
      store.presentation,
      storeConnect,
      selectSingle,
    ],
  );

  const onResizeStart = useCallback(
    (e: React.MouseEvent, resource: ResourceInstance) => {
      iOnResizeStart(e, resource, {
        rects: layout.rects,
        readOnly: store.presentation,
        selectSingle,
      });
    },
    [iOnResizeStart, layout, store.presentation, selectSingle],
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

  const { toggleExpandedGroup: storeToggleExpandedGroup } = store;
  const onExpandGroup = useCallback(
    (parentId: string, serviceId: string) =>
      storeToggleExpandedGroup(summaryKey(parentId, serviceId)),
    [storeToggleExpandedGroup],
  );

  const draw = useCallback(() => {
    // Cull to the viewport only for large graphs; keep the fast path otherwise.
    let cullViewport: Rect | null = null;
    if (store.resources.length > CULL_THRESHOLD) {
      const vw = viewportWorldRect(store.viewport, viewSize());
      cullViewport = expandRect(vw, Math.max(vw.w, vw.h) * 0.3);
    }
    rDraw(
      store.resources,
      store.relationships,
      store.viewport,
      store.selection,
      store.selectedIds,
      store.density,
      focusId,
      layout,
      store.collapsed,
      focusSubtree,
      store.hiddenCategories,
      store.hiddenRelClasses,
      store.filterMode,
      overlayHeat ?? envTintById,
      store.activeOverlay === "heat" ? "heat" : "env",
      cullViewport,
      store.edgeStyle,
      store.searchMatches,
      overlayLit,
      onNodeMouseDown,
      store.presentation ? null : onResizeStart,
      onConnectCb,
      storeSetSelection,
      onHover,
      store.toggleCollapsed,
      onExpandGroup,
    );
  }, [
    viewSize,
    rDraw,
    store.resources,
    store.relationships,
    store.viewport,
    store.selection,
    store.selectedIds,
    store.density,
    focusId,
    layout,
    store.collapsed,
    focusSubtree,
    store.hiddenCategories,
    store.hiddenRelClasses,
    store.filterMode,
    envTintById,
    overlayHeat,
    overlayLit,
    store.activeOverlay,
    store.edgeStyle,
    store.searchMatches,
    onNodeMouseDown,
    onResizeStart,
    store.presentation,
    onConnectCb,
    storeSetSelection,
    onHover,
    store.toggleCollapsed,
    onExpandGroup,
  ]);
  const drawMinimap = useCallback(
    () => rDrawMinimap(store.resources, layout, store.viewport, viewSize()),
    [rDrawMinimap, store.resources, layout, store.viewport, viewSize],
  );
  const fitToView = useCallback(() => {
    const bounds = boundsOf([...layout.rects.values()]);
    if (!bounds) {
      storeSetViewport({ x: 200, y: 120, scale: 1 });
      return;
    }
    storeSetViewport(fitView(bounds, viewSize()));
  }, [layout, storeSetViewport, viewSize]);
  const center = useCallback(
    () => iCenter(getViewport(), storeSetViewport),
    [iCenter, getViewport, storeSetViewport],
  );

  /** Auto-arrange top-level nodes into a tidy, relationship-layered layout (one
   *  undo step). Containers already auto-pack their children via the layout
   *  engine; this lays the roots out left-to-right by dependency flow. */
  const tidy = useCallback(() => {
    const packed = arrangeTiered(store.resources, store.relationships, isContainerPred);
    if (packed.length === 0) return;
    updateResourcePositions(packed);
    commitCurrentState();
  }, [
    store.resources,
    store.relationships,
    isContainerPred,
    updateResourcePositions,
    commitCurrentState,
  ]);

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
      fitToView();
      return;
    }
    const boxes = ids.map((id) => layout.rects.get(id)).filter((r): r is Rect => !!r);
    const bounds = boundsOf(boxes);
    if (!bounds) return;
    storeSetViewport(fitView(bounds, viewSize(), { maxScale: 1.4 }));
  }, [store.selectedIds, store.selection, layout, fitToView, storeSetViewport, viewSize]);

  /**
   * Focus a container: frame its subtree (zoom-to-fit) and dim everything
   * outside it. Toggling the same container off clears the focus.
   */
  const focusContainer = useCallback(
    (id: string | null) => {
      setFocusedContainerId(id);
      if (!id) return;
      const bounds = layout.rects.get(id);
      if (bounds) storeSetViewport(fitView(bounds, viewSize(), { maxScale: 1.2 }));
    },
    [setFocusedContainerId, layout, storeSetViewport, viewSize],
  );

  /**
   * Select a node and centre the viewport on it (⌘K jump / search). If the
   * target is hidden inside collapsed containers or behind an "N×" summary,
   * reveal it first (expand ancestors + its summary group), then centre using a
   * freshly-computed layout so the camera lands correctly this tick.
   */
  const goToResource = useCallback(
    (id: string) => {
      selectSingle(id);
      const byId = new Map(store.resources.map((r) => [r.id, r]));
      const target = byId.get(id);
      if (!target) return;

      // Expand every collapsed ancestor on the path to the root.
      const nextCollapsed = new Set(store.collapsed);
      const guard = new Set<string>();
      let cur = target.parentId;
      while (cur && byId.has(cur) && !guard.has(cur)) {
        guard.add(cur);
        nextCollapsed.delete(cur);
        cur = byId.get(cur)?.parentId;
      }
      // Expand the target's own summary group, if it is summarized.
      const nextExpanded = new Set(store.expandedGroups);
      if (target.parentId) nextExpanded.add(summaryKey(target.parentId, target.serviceId));

      if (nextCollapsed.size !== store.collapsed.size) setCollapsedIds(nextCollapsed);
      nextExpanded.forEach((k) => expandGroup(k));

      // Centre using a layout that reflects the revealed state.
      const revealed = computeLayout(store.resources, {
        collapsed: nextCollapsed,
        isContainer: isContainerPred,
        density: store.density,
        summarize: { threshold: SUMMARY_THRESHOLD, expandedGroups: nextExpanded },
      });
      const rect = revealed.rects.get(id);
      if (rect) {
        storeSetViewport(
          panToCenter(
            { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 },
            viewSize(),
            getViewport().scale,
          ),
        );
      }
    },
    [
      selectSingle,
      store.resources,
      store.collapsed,
      store.expandedGroups,
      setCollapsedIds,
      expandGroup,
      store.density,
      isContainerPred,
      storeSetViewport,
      viewSize,
      getViewport,
    ],
  );

  /** Double-clicking a container toggles focus on it (zoom-to-fit + dim others). */
  const onNodeDoubleClick = useCallback(
    (id: string) => {
      if (!layout.isContainerNode(id)) return;
      focusContainer(store.focusedContainerId === id ? null : id);
    },
    [layout, focusContainer, store.focusedContainerId],
  );

  /** Ancestor path (root → target) of the focused container, else the single
   *  selected node — rendered as a clickable breadcrumb. */
  const breadcrumb = React.useMemo<Array<{ id: string; name: string }>>(() => {
    const targetId =
      store.focusedContainerId ?? (store.selection?.type === "node" ? store.selection.id : null);
    if (!targetId) return [];
    const byId = new Map(store.resources.map((r) => [r.id, r]));
    const chain: Array<{ id: string; name: string }> = [];
    const guard = new Set<string>();
    let cur = byId.get(targetId);
    while (cur && !guard.has(cur.id)) {
      guard.add(cur.id);
      chain.unshift({ id: cur.id, name: cur.name });
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    return chain;
  }, [store.focusedContainerId, store.selection, store.resources]);

  // ---- view presets + saved views ----------------------------------------
  const { setLayers: storeSetLayers } = store;

  const applyViewPreset = useCallback(
    (name: ViewPreset) => {
      const hideAllBut = (keep: RelationshipClass): Set<RelationshipClass> =>
        new Set(RELATIONSHIP_CLASS_ORDER.filter((c) => c !== keep));
      const base: LayerState = {
        hiddenCategories: new Set(),
        hiddenRelClasses: new Set(),
        filterMode: "dim",
        environmentTint: store.environmentTint,
      };
      switch (name) {
        case "network":
          storeSetLayers({ ...base, hiddenRelClasses: hideAllBut("network") });
          break;
        case "security":
          storeSetLayers({ ...base, hiddenRelClasses: hideAllBut("permission") });
          break;
        case "data":
          storeSetLayers({ ...base, hiddenRelClasses: hideAllBut("data") });
          break;
        case "high-level": {
          storeSetLayers(base);
          setCollapsedIds(
            store.resources.filter((r) => layout.isContainerNode(r.id)).map((r) => r.id),
          );
          break;
        }
        case "all":
        default:
          storeSetLayers(base);
          setCollapsedIds([]);
          break;
      }
    },
    [storeSetLayers, setCollapsedIds, store.environmentTint, store.resources, layout],
  );

  const [savedViews, setSavedViews] = React.useState<SavedView[]>([]);
  useEffect(() => {
    setSavedViews(readSavedViews());
  }, []);
  const persistViews = useCallback((views: SavedView[]) => {
    setSavedViews(views);
    if (typeof localStorage !== "undefined") {
      try {
        localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(views));
      } catch {
        /* storage unavailable / quota — keep the in-memory list */
      }
    }
  }, []);
  const saveView = useCallback(
    (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      const view: SavedView = {
        name: trimmed,
        hiddenCategories: [...store.hiddenCategories],
        hiddenRelClasses: [...store.hiddenRelClasses],
        filterMode: store.filterMode,
        environmentTint: store.environmentTint,
      };
      persistViews([...savedViews.filter((v) => v.name !== trimmed), view]);
    },
    [
      savedViews,
      persistViews,
      store.hiddenCategories,
      store.hiddenRelClasses,
      store.filterMode,
      store.environmentTint,
    ],
  );
  const applySavedView = useCallback(
    (name: string) => {
      const v = savedViews.find((x) => x.name === name);
      if (!v) return;
      storeSetLayers({
        hiddenCategories: new Set(v.hiddenCategories as ServiceCategoryId[]),
        hiddenRelClasses: new Set(v.hiddenRelClasses as RelationshipClass[]),
        filterMode: v.filterMode,
        environmentTint: v.environmentTint,
      });
    },
    [savedViews, storeSetLayers],
  );
  const deleteSavedView = useCallback(
    (name: string) => persistViews(savedViews.filter((v) => v.name !== name)),
    [savedViews, persistViews],
  );

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
      const content = boundsOf([...layout.rects.values()]);
      const t = minimapTransform(content, viewportWorldRect(vp, view), { w: bw, h: bh });
      const world = minimapToWorld(t, { x: mx, y: my });
      storeSetViewport(panToCenter(world, view, vp.scale));
    },
    [minimapRef, getViewport, viewSize, layout, storeSetViewport],
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
  const exportJSON = useCallback(() => {
    const graph = buildGraph();
    const blob = new Blob([JSON.stringify(graph, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "aws-architecture.json";
    a.click();
  }, [buildGraph]);

  /** Download a blob with a given filename (shared by the image exporters). */
  const downloadBlob = useCallback((blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }, []);

  /** Export the diagram as an SVG (vector) or PNG (rasterised from the SVG). */
  const exportImage = useCallback(
    async (format: "svg" | "png") => {
      const svg = buildSvg({
        resources: store.resources,
        edges: store.relationships.map((e) => ({ from: e.from, to: e.to })),
        rects: layout.rects,
        color: (sid) => serviceColor(sid),
        icon: (sid) => serviceIcon(sid),
        label: (r) => r.name,
        isContainer: (id) => layout.isContainerNode(id),
      });
      if (!svg) {
        setStatus("Nothing to export — the canvas is empty.");
        return;
      }
      const base =
        (store.graphName || "diagram").replace(/[^\w.-]+/g, "-").toLowerCase() || "diagram";
      if (format === "svg") {
        downloadBlob(new Blob([svg], { type: "image/svg+xml" }), `${base}.svg`);
        setStatus("Exported SVG.");
        return;
      }
      // PNG: rasterise the SVG at 2× via an offscreen canvas.
      try {
        const img = new Image();
        const svgUrl = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error("decode failed"));
          img.src = svgUrl;
        });
        const scale = 2;
        const canvas = document.createElement("canvas");
        canvas.width = (img.naturalWidth || img.width) * scale;
        canvas.height = (img.naturalHeight || img.height) * scale;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("no 2d context");
        ctx.scale(scale, scale);
        ctx.drawImage(img, 0, 0);
        URL.revokeObjectURL(svgUrl);
        const png = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/png"));
        if (!png) throw new Error("encode failed");
        downloadBlob(png, `${base}.png`);
        setStatus("Exported PNG.");
      } catch {
        setStatus("PNG export failed — try SVG instead.");
      }
    },
    [store.resources, store.relationships, store.graphName, layout, downloadBlob],
  );

  /** Copy a self-contained share link (the diagram packed into the URL hash). */
  const shareDiagram = useCallback(async () => {
    const graph = buildGraph();
    if (graph.resources.length === 0) {
      setStatus("Nothing to share — the canvas is empty.");
      return;
    }
    const base =
      typeof location !== "undefined"
        ? location.origin + location.pathname
        : "https://strata.mk-dir.com/";
    const url = buildShareUrl(base, graph);
    try {
      await navigator.clipboard.writeText(url);
      setStatus("Share link copied to clipboard.");
    } catch {
      setStatus("Couldn't copy automatically — your share link is in the address bar.");
      if (typeof location !== "undefined") location.hash = url.slice(url.indexOf("#") + 1);
    }
  }, [buildGraph]);

  const importJSONDialog = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onerror = () => setStatus("Import failed: could not read file.");
      reader.onload = async () => {
        try {
          const parsed = JSON.parse(String(reader.result)) as unknown;
          if (typeof parsed !== "object" || parsed === null) {
            throw new Error("not an object");
          }
          const g = parsed as Partial<InfrastructureGraph>;
          if (!Array.isArray(g.resources)) {
            throw new Error("missing resources array");
          }
          // Confirm AFTER parsing, just before the destructive replace, so a
          // bad file never costs the user their current work.
          if (!(await confirmReplaceIfDirty())) {
            setStatus("Import canceled.");
            return;
          }
          storeReplaceAll({
            resources: g.resources ?? [],
            relationships: g.relationships ?? [],
            viewport: g.viewport,
            accounts: g.accounts ?? [],
            graphId: g.id ?? "",
            graphName: g.name || "Imported diagram",
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
  }, [storeReplaceAll, confirmReplaceIfDirty]);

  const importIaCDialog = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,.yaml,.yml,.tf,.tfstate,.template";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onerror = () => setStatus("Import failed: could not read file.");
      reader.onload = async () => {
        try {
          const text = String(reader.result);
          const result = importAnyIaC(text, { name: file.name });
          const { graph, format, unmappedTypes, warnings } = result;
          if (!(await confirmReplaceIfDirty())) {
            setStatus("Import canceled.");
            return;
          }
          storeReplaceAll({
            resources: graph.resources ?? [],
            relationships: graph.relationships ?? [],
            viewport: graph.viewport,
            accounts: graph.accounts ?? [],
            graphId: graph.id ?? "",
            graphName: graph.name || file.name.replace(/\.[^.]+$/, "") || "Imported diagram",
          });
          storeSetSelection(null);
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
  }, [storeReplaceAll, storeSetSelection, confirmReplaceIfDirty]);

  // ---- Save / load (browser-local) ----------------------------------------
  const saveGraph = useCallback(async () => {
    try {
      setStatus("Saving…");
      const graph = buildGraph();
      const saved = store.graphId
        ? await updateGraph(store.graphId, graph)
        : await createGraph(graph);
      storeSetGraphId(saved.id);
      storeMarkSaved();
      setStatus(`Saved "${saved.name}" to this browser.`);
    } catch (err) {
      setStatus(
        `Save failed: ${err instanceof Error ? err.message : "could not write to storage."}`,
      );
    }
  }, [buildGraph, store.graphId, storeSetGraphId, storeMarkSaved]);

  /** List saved graphs for the Load menu (returns [] and reports on failure). */
  const listSavedGraphs = useCallback(async (): Promise<GraphSummary[]> => {
    try {
      return await listGraphs();
    } catch {
      setStatus("Couldn't read saved diagrams from this browser.");
      return [];
    }
  }, []);

  /** Load a saved graph by id (replaces the current model). */
  const loadGraph = useCallback(
    async (id: string) => {
      if (!(await confirmReplaceIfDirty())) return;
      try {
        setStatus("Loading…");
        const g = await getGraph(id);
        storeReplaceAll({
          resources: g.resources ?? [],
          relationships: g.relationships ?? [],
          viewport: g.viewport,
          accounts: g.accounts ?? [],
          graphId: g.id,
          graphName: g.name || "Untitled diagram",
        });
        // Loaded state matches what's saved — not unsaved work.
        storeMarkSaved();
        setStatus(`Loaded "${g.name}".`);
      } catch (err) {
        setStatus(`Load failed: ${err instanceof Error ? err.message : "diagram unavailable."}`);
      }
    },
    [storeReplaceAll, confirmReplaceIfDirty, storeMarkSaved],
  );

  /** Delete a saved graph by id (clears graphId if it was the open one). */
  const deleteSavedGraph = useCallback(
    async (id: string) => {
      try {
        await deleteGraph(id);
        if (store.graphId === id) storeSetGraphId("");
        setStatus("Deleted saved diagram.");
      } catch {
        setStatus("Delete failed.");
      }
    },
    [store.graphId, storeSetGraphId],
  );

  // ---- Presets ------------------------------------------------------------
  const loadPreset = useCallback(
    async (presetName: string) => {
      const resources: ResourceInstance[] = [];
      const relationships: Relationship[] = [];
      const seed = (
        serviceId: string,
        x: number,
        y: number,
        name: string,
        config: Record<string, unknown> = {},
        parentId?: string,
      ) => {
        const id = storeUid();
        const svc = getService(serviceId);
        resources.push({
          id,
          serviceId,
          name: name || svc?.name || serviceId,
          config: { ...defaultConfig(serviceId), ...config },
          source: "manual",
          position: { x, y, ...DEFAULT_NODE_SIZE },
          parentId,
        });
        return id;
      };
      const link = (from: string, to: string, kind: RelationshipKind) => {
        relationships.push({ id: storeUid(), from, to, kind, source: "manual" });
      };

      if (presetName === "aws-basic") {
        const vpc = seed("vpc", 80, 120, "VPC", { cidr: "10.0.0.0/16" });
        // Subnets nest inside the VPC (containment is nesting, not an edge).
        seed("subnet-public", 140, 220, "Public A", { cidr: "10.0.1.0/24", az: "us-east-1a" }, vpc);
        seed(
          "subnet-private",
          140,
          360,
          "Private A",
          { cidr: "10.0.2.0/24", az: "us-east-1a" },
          vpc,
        );
        const igw = seed("internet-gateway", 560, 140, "IGW");
        link(igw, vpc, "attached_to");
      } else if (presetName === "ecs-alb") {
        const vpc = seed("vpc", 80, 120, "VPC", { cidr: "10.0.0.0/16" });
        const pubA = seed(
          "subnet-public",
          140,
          220,
          "Public A",
          { cidr: "10.0.1.0/24", az: "us-east-1a" },
          vpc,
        );
        const priA = seed(
          "subnet-private",
          140,
          360,
          "Private A",
          { cidr: "10.0.2.0/24", az: "us-east-1a" },
          vpc,
        );
        const igw = seed("internet-gateway", 760, 140, "IGW");
        const nat = seed("nat-gateway", 760, 260, "NAT GW");
        const rtPub = seed("route-table", 760, 380, "RT Public");
        const rtPri = seed("route-table", 760, 500, "RT Private");
        const nacl = seed("nacl", 760, 620, "App NACL");
        const alb = seed("elastic-load-balancer", 1000, 200, "ALB");
        const sgAlb = seed("security-group", 1000, 80, "SG-ALB");
        const ecs = seed("ecs-service", 1000, 460, "App Service", { port: 3000 });
        const sgApp = seed("security-group", 1000, 340, "SG-App");
        const tg = seed("target-group", 1000, 320, "TG-App", { port: 3000 });

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
      } else if (presetName === "serverless-api") {
        const api = seed("api-gateway", 0, 0, "HTTP API");
        const fn = seed("lambda", 0, 0, "request-handler", { runtime: "nodejs20.x", memory: 256 });
        const worker = seed("lambda", 0, 0, "async-worker");
        const ddb = seed("dynamodb", 0, 0, "Table", { billingMode: "PAY_PER_REQUEST" });
        const queue = seed("sqs", 0, 0, "Jobs");
        const topic = seed("sns", 0, 0, "Events");
        const bucket = seed("s3-bucket", 0, 0, "Uploads", { blockPublicAccess: true });
        link(api, fn, "invokes");
        link(fn, ddb, "reads_from");
        link(fn, bucket, "writes_to");
        link(fn, queue, "writes_to");
        link(worker, queue, "subscribes_to");
        link(fn, topic, "publishes_to");
      } else if (presetName === "static-website") {
        const dns = seed("route53", 0, 0, "DNS");
        const cdn = seed("cloudfront", 0, 0, "CDN");
        const waf = seed("waf", 0, 0, "WAF");
        const bucket = seed("s3-bucket", 0, 0, "Site assets", {
          blockPublicAccess: true,
          encryption: "SSE-S3",
        });
        link(dns, cdn, "routes_to");
        link(cdn, bucket, "reads_from");
        link(waf, cdn, "attached_to");
      } else {
        return;
      }

      if (!(await confirmReplaceIfDirty())) return;
      // Open already-arranged: lay top-level nodes out by dependency flow so the
      // template reads cleanly instead of relying on hand-tuned coordinates.
      const arranged = new Map(
        arrangeTiered(resources, relationships, (r) => !!getService(r.serviceId)?.isContainer).map(
          (p) => [p.id, p],
        ),
      );
      for (const r of resources) {
        const p = arranged.get(r.id);
        if (p) r.position = { ...DEFAULT_NODE_SIZE, ...r.position, x: p.x, y: p.y };
      }
      storeReplaceAll({
        resources,
        relationships,
        viewport: { x: 120, y: 80, scale: 0.85 },
        accounts: [],
        graphId: "",
        graphName:
          (
            {
              "ecs-alb": "ECS + ALB starter",
              "serverless-api": "Serverless API starter",
              "static-website": "Static Website starter",
            } as Record<string, string>
          )[presetName] ?? "Basic AWS starter",
      });
    },
    [storeUid, storeReplaceAll, confirmReplaceIfDirty],
  );

  /** Load a bundled example architecture onto the canvas (guarded). Treated as a
   *  fresh unsaved diagram (graphId cleared) so saving never overwrites a file. */
  const loadExample = useCallback(
    async (exampleId: string) => {
      const ex = getExample(exampleId);
      if (!ex) return;
      if (!(await confirmReplaceIfDirty())) return;
      const g = ex.graph;
      storeReplaceAll({
        resources: g.resources ?? [],
        relationships: g.relationships ?? [],
        viewport: g.viewport,
        accounts: g.accounts ?? [],
        graphId: "",
        graphName: g.name || ex.label,
      });
      setStartHubOpen(false);
      setStatus(`Loaded example "${g.name}".`);
    },
    [storeReplaceAll, confirmReplaceIfDirty],
  );

  // Guarded clear — both the toolbar and ⌘K route through here, so the
  // unsaved-work check applies everywhere. storeClear no longer prompts.
  const clear = useCallback(async () => {
    if (await confirmReplaceIfDirty()) storeClear();
  }, [confirmReplaceIfDirty, storeClear]);

  // Start a fresh blank diagram from the hub (guarded), then dismiss the hub.
  const startBlank = useCallback(async () => {
    if (await confirmReplaceIfDirty()) {
      storeClear();
      setStartHubOpen(false);
    }
  }, [confirmReplaceIfDirty, storeClear]);

  // Resolve the pending replace confirmation. "save" persists the current graph
  // first (so "Save & continue" really saves) before proceeding.
  const resolveReplaceConfirm = useCallback(
    async (choice: "save" | "discard" | "cancel") => {
      setReplaceConfirmOpen(false);
      const resolve = replaceResolverRef.current;
      replaceResolverRef.current = null;
      if (!resolve) return;
      if (choice === "save") {
        await saveGraph();
        resolve(true);
      } else {
        resolve(choice === "discard");
      }
    },
    [saveGraph],
  );

  // First mount on a blank canvas: a never-onboarded visitor gets the guided
  // tour (which then hands off to the hub); a returning one gets the hub
  // straight away. Never a forced gate for a session that already has content.
  const autoOpenedHubRef = useRef(false);
  useEffect(() => {
    if (autoOpenedHubRef.current) return;
    autoOpenedHubRef.current = true;
    // A share link (#g=…) loads its diagram and skips the hub/tour entirely.
    const shared = typeof location !== "undefined" ? readGraphFromHash(location.hash) : null;
    if (shared) {
      storeReplaceAll({
        resources: shared.resources ?? [],
        relationships: shared.relationships ?? [],
        viewport: shared.viewport,
        accounts: shared.accounts ?? [],
        graphId: "",
        graphName: shared.name || "Shared diagram",
      });
      // Drop the (large) hash so a refresh doesn't reload and the URL stays clean.
      try {
        history.replaceState(null, "", location.pathname + location.search);
      } catch {
        /* ignore */
      }
      setStatus("Loaded a shared diagram.");
      return;
    }
    if (store.resources.length > 0) return;
    let onboarded = false;
    try {
      onboarded = localStorage.getItem(ONBOARDED_KEY) === "1";
    } catch {
      /* ignore */
    }
    if (onboarded) setStartHubOpen(true);
    else setTourOpen(true);
    // Mount-only: deliberately not reacting to later resource changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Locals so the memoized panel value re-computes when history depth changes
  // (the booleans, not the stable canUndo/canRedo functions, are the deps).
  const canUndo = store.canUndo();
  const canRedo = store.canRedo();

  // The Canvas-only, high-churn slice (viewport, transient drag visuals, and the
  // imperative draw/pointer handlers). Plain object: the Canvas re-renders on
  // pan anyway, and no panel consumes this context — so panels are insulated.
  const canvasValue: FlowCanvasContextValue = {
    viewport: store.viewport,
    guides,
    marquee,
    draw,
    drawMinimap,
    onCanvasMouseDown,
    onMouseMove,
    onMouseUp,
    onWheelZoom,
    addResourceFromPalette,
    minimapNavigate,
  };

  // Memoized so panels only re-render when something they read actually changes
  // — NOT on every pan/zoom/hover (those live in FlowCanvasContext).
  const value: FlowContextValue = React.useMemo(
    () => ({
      state,
      worldRef,
      svgRef,
      minimapRef,
      selection: store.selection,
      selectedIds: store.selectedIds,

      setMode: store.setMode,
      toggleMode,
      setDensity: store.setDensity,
      focusContainer,
      onNodeDoubleClick,
      goToResource,
      setSearchMatches: store.setSearchMatches,
      breadcrumb,
      focusedContainerId: store.focusedContainerId,

      hiddenCategories: store.hiddenCategories,
      hiddenRelClasses: store.hiddenRelClasses,
      filterMode: store.filterMode,
      environmentTint: store.environmentTint,
      edgeStyle: store.edgeStyle,
      setEdgeStyle: store.setEdgeStyle,
      presentation: store.presentation,
      setPresentation: store.setPresentation,
      activeOverlay: store.activeOverlay,
      setActiveOverlay: store.setActiveOverlay,
      toggleCategory: store.toggleCategory,
      toggleRelClass: store.toggleRelClass,
      setFilterMode: store.setFilterMode,
      setEnvironmentTint: store.setEnvironmentTint,
      applyViewPreset,
      savedViews,
      saveView,
      applySavedView,
      deleteSavedView,

      select: store.setSelection,
      removeSelection: store.removeSelection,
      duplicateSelection: store.duplicateSelection,
      groupIntoVPC: store.groupIntoVPC,
      updateResourceField,
      updateRelationshipKind,

      onCanvasClick: clearSelection,
      setSpacePressed: interaction.setSpacePressed,
      fitToView,
      center,
      tidy,
      zoomIn,
      zoomOut,
      zoomReset,
      zoomToSelection,

      undo: store.undo,
      redo: store.redo,
      canUndo,
      canRedo,

      validate: runValidate,
      suggestRules: runSuggest,
      exportJSON,
      exportImage,
      shareDiagram,
      importJSONDialog,
      importIaCDialog,
      clear,
      loadPreset,
      loadExample,
      graphName: store.graphName,
      renameGraph: store.setGraphName,
      dirty: store.dirty,
      startHubOpen,
      openStartHub,
      closeStartHub,
      tourOpen,
      tourStep,
      openTour,
      closeTour,
      setTourStep: setTourStepClamped,
      startBlank,
      replaceConfirmOpen,
      resolveReplaceConfirm,
      exportIaCOpen,
      openExportIaC,
      closeExportIaC,
      snapshotGraph: buildGraph,
      connectOpen,
      openConnect,
      closeConnect,
      importDiscoveredGraph,
      runValidateUI: runValidate,
      runRulesUI: runSuggest,
      saveGraph,
      listSavedGraphs,
      loadGraph,
      deleteSavedGraph,
      validationResults,
      liveFindings,
      findingMarkers,
      findingCounts,
      showCost,
      toggleCost,
      costSummary,
      costMarkers,
      ruleSuggestions,
      status,
    }),
    [
      state,
      worldRef,
      svgRef,
      minimapRef,
      store.selection,
      store.selectedIds,
      store.setMode,
      toggleMode,
      store.setDensity,
      focusContainer,
      onNodeDoubleClick,
      goToResource,
      store.setSearchMatches,
      breadcrumb,
      store.focusedContainerId,
      store.hiddenCategories,
      store.hiddenRelClasses,
      store.filterMode,
      store.environmentTint,
      store.edgeStyle,
      store.setEdgeStyle,
      store.presentation,
      store.setPresentation,
      store.activeOverlay,
      store.setActiveOverlay,
      store.toggleCategory,
      store.toggleRelClass,
      store.setFilterMode,
      store.setEnvironmentTint,
      applyViewPreset,
      savedViews,
      saveView,
      applySavedView,
      deleteSavedView,
      store.setSelection,
      store.removeSelection,
      store.duplicateSelection,
      store.groupIntoVPC,
      updateResourceField,
      updateRelationshipKind,
      clearSelection,
      interaction.setSpacePressed,
      fitToView,
      center,
      tidy,
      zoomIn,
      zoomOut,
      zoomReset,
      zoomToSelection,
      store.undo,
      store.redo,
      canUndo,
      canRedo,
      runValidate,
      runSuggest,
      exportJSON,
      exportImage,
      shareDiagram,
      importJSONDialog,
      importIaCDialog,
      clear,
      loadPreset,
      loadExample,
      store.graphName,
      store.setGraphName,
      store.dirty,
      startHubOpen,
      openStartHub,
      closeStartHub,
      tourOpen,
      tourStep,
      openTour,
      closeTour,
      setTourStepClamped,
      startBlank,
      replaceConfirmOpen,
      resolveReplaceConfirm,
      exportIaCOpen,
      openExportIaC,
      closeExportIaC,
      buildGraph,
      connectOpen,
      openConnect,
      closeConnect,
      importDiscoveredGraph,
      saveGraph,
      listSavedGraphs,
      loadGraph,
      deleteSavedGraph,
      validationResults,
      liveFindings,
      findingMarkers,
      findingCounts,
      showCost,
      toggleCost,
      costSummary,
      costMarkers,
      ruleSuggestions,
      status,
    ],
  );

  return (
    <FlowContext.Provider value={value}>
      <FlowCanvasContext.Provider value={canvasValue}>{children}</FlowCanvasContext.Provider>
    </FlowContext.Provider>
  );
};
