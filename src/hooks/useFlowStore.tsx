"use client";
import { useState, useCallback, useRef, useEffect } from "react";
import type { ResourceInstance, Relationship, Viewport, Account } from "../aws/model";
import { DEFAULT_NODE_SIZE } from "../aws/model";
import type { CanvasMode, CanvasDensity, Selection } from "../types";
import type { RelationshipKind, ServiceCategoryId } from "../aws/types";
import type { RelationshipClass } from "../aws/relationshipClasses";
import type { OverlayKind } from "../aws/overlays";
import { defaultConfig, getService } from "../aws/registry";
import { GRID_STEP } from "../canvas/geometry";
import { useHistory, type HistoryState } from "./useHistory";

/** Round a world coordinate to the visible grid step (matches drag snapping). */
const snapToGrid = (n: number) => Math.round(n / GRID_STEP) * GRID_STEP;

/** Visibility layers / filters / overlay (view-only, not in history). */
export interface LayerState {
  hiddenCategories: ReadonlySet<ServiceCategoryId>;
  hiddenRelClasses: ReadonlySet<RelationshipClass>;
  filterMode: "dim" | "hide";
  environmentTint: boolean;
}

/** Return a new Set with `value` toggled. */
function toggledSet<T>(set: ReadonlySet<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

interface FlowState extends HistoryState {
  resources: ResourceInstance[];
  relationships: Relationship[];
  viewport: Viewport;
  accounts: Account[];
  graphId: string;
}

const DEFAULT_VIEWPORT: Viewport = { x: 200, y: 120, scale: 1 };

/** Build a UI Selection object for a resource. */
function nodeSelection(resource: ResourceInstance): Selection {
  return { type: "node", id: resource.id, resource };
}

/** Build a UI Selection object for a relationship. */
function edgeSelection(rel: Relationship, resources: ResourceInstance[]): Selection {
  const from = resources.find((r) => r.id === rel.from);
  const to = resources.find((r) => r.id === rel.to);
  return {
    type: "edge",
    id: rel.id,
    relationship: rel,
    fromName: from?.name ?? rel.from,
    toName: to?.name ?? rel.to,
  };
}

export function useFlowStore() {
  const [resources, setResources] = useState<ResourceInstance[]>([]);
  const [relationships, setRelationships] = useState<Relationship[]>([]);
  const [viewport, setViewport] = useState<Viewport>({ ...DEFAULT_VIEWPORT });
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [mode, setMode] = useState<CanvasMode>("move");
  // View-only node density (not part of the model / history).
  const [density, setDensity] = useState<CanvasDensity>("comfortable");
  // View-only containment state: collapsed container ids, the focused container
  // (zoom-to-fit + dim siblings), and a live drag override (node + subtree
  // detached to a free anchor while dragging). None of these are in history.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [focusedContainerId, setFocusedContainerId] = useState<string | null>(null);
  const [dragOverride, setDragOverride] = useState<{ id: string; x: number; y: number } | null>(
    null,
  );
  // View-only layer/filter/overlay state (Phase 3) — not in history.
  const [hiddenCategories, setHiddenCategories] = useState<ReadonlySet<ServiceCategoryId>>(
    new Set(),
  );
  const [hiddenRelClasses, setHiddenRelClasses] = useState<ReadonlySet<RelationshipClass>>(
    new Set(),
  );
  const [filterMode, setFilterMode] = useState<"dim" | "hide">("dim");
  const [environmentTint, setEnvironmentTint] = useState(false);
  // Edge routing style (view-only).
  const [edgeStyle, setEdgeStyle] = useState<"curved" | "orthogonal">("curved");
  // Nodes matching the active search query (highlighted; view-only, transient).
  const [searchMatches, setSearchMatches] = useState<ReadonlySet<string>>(new Set());
  // Presentation / read-only mode: hides editing chrome and gates edits.
  const [presentation, setPresentation] = useState(false);
  // Active analytical overlay (Phase 6): none | iam | security | heat.
  const [activeOverlay, setActiveOverlay] = useState<OverlayKind>("none");
  // Summary group keys (`${parentId}::${serviceId}`) that are expanded (shown
  // as individual nodes rather than a single "N× …" summary). View-only.
  const [expandedGroups, setExpandedGroups] = useState<ReadonlySet<string>>(new Set());
  const [selection, setSelection] = useState<Selection>(null);
  // Multi-selection set (marquee / group operations). The single `selection`
  // above still drives the Inspector detail view; `selectedIds` drives group
  // move, multi-delete and the selected outline for every member.
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [graphId, setGraphId] = useState<string>("");
  // Guards against re-committing to history while an undo/redo restore is in
  // flight. Set synchronously in `applyState` and cleared on the next
  // microtask so any synchronous commit calls triggered by the restore are
  // ignored.
  const isRestoringRef = useRef<boolean>(false);

  const { commit, undo, redo, canUndo, canRedo } = useHistory<FlowState>();

  const uid = useCallback(() => crypto.randomUUID(), []);

  // Live mirror of the canvas-relevant state so commit-after-mutate actions can
  // snapshot the *new* values without waiting for a re-render. Updated through
  // the `apply*` helpers below.
  const liveRef = useRef<FlowState>({
    resources,
    relationships,
    viewport,
    accounts,
    graphId,
  });

  /** Record a snapshot in history (ignored while restoring undo/redo). */
  const record = useCallback(
    (state: FlowState) => {
      if (isRestoringRef.current) return;
      commit(state);
    },
    [commit],
  );

  // Seed history with the initial (empty) state once so the very first edit has
  // a baseline to undo back to. Without this the first mutation's pre-state is
  // lost and undo stops one step short of the start.
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current) return;
    seededRef.current = true;
    commit({ ...liveRef.current });
  }, [commit]);

  /** Apply a committed/new state to React + the live mirror. */
  const setLive = useCallback((next: FlowState) => {
    liveRef.current = next;
    setResources(next.resources);
    setRelationships(next.relationships);
    setViewport(next.viewport);
    setAccounts(next.accounts);
    setGraphId(next.graphId);
  }, []);

  /**
   * Apply a mutation to the canvas-relevant state AND record the resulting
   * state in history (commit-AFTER-mutate). `patch` receives the current live
   * state and returns the changed fields.
   */
  const mutate = useCallback(
    (patch: (cur: FlowState) => Partial<FlowState>) => {
      const cur = liveRef.current;
      const next: FlowState = { ...cur, ...patch(cur) };
      setLive(next);
      record(next);
      return next;
    },
    [setLive, record],
  );

  const applyState = useCallback(
    (state: FlowState) => {
      isRestoringRef.current = true;
      setLive(state);
      setSelection(null);
      setSelectedIds([]);
      setFocusedContainerId(null);
      setDragOverride(null);
      setSearchMatches(new Set());
      // Clear on the next microtask rather than a macrotask (setTimeout): this
      // runs before any subsequent user-triggered macrotask could synchronously
      // call a commit, closing the race window.
      void Promise.resolve().then(() => {
        isRestoringRef.current = false;
      });
    },
    [setLive],
  );

  const undoAction = useCallback(() => {
    const prev = undo();
    if (prev) applyState(prev);
  }, [undo, applyState]);

  const redoAction = useCallback(() => {
    const next = redo();
    if (next) applyState(next);
  }, [redo, applyState]);

  /** Create a new resource from a service id at world coordinates. */
  const addResource = useCallback(
    (serviceId: string, x: number, y: number) => {
      const svc = getService(serviceId);
      if (!svc) return;
      const id = uid();
      const resource: ResourceInstance = {
        id,
        serviceId,
        name: svc.name,
        config: defaultConfig(serviceId),
        source: "manual",
        position: { x: snapToGrid(x), y: snapToGrid(y), ...DEFAULT_NODE_SIZE },
      };
      mutate((cur) => ({ resources: [...cur.resources, resource] }));
      setSelection(nodeSelection(resource));
      setSelectedIds([id]);
    },
    [mutate, uid],
  );

  const removeSelection = useCallback(() => {
    // Multi-selection (marquee/group) takes precedence: delete every selected
    // node and any relationship touching one of them, in a single history step.
    if (selectedIds.length > 0) {
      const ids = new Set(selectedIds);
      mutate((cur) => ({
        resources: cur.resources.filter((r) => !ids.has(r.id)),
        relationships: cur.relationships.filter((e) => !ids.has(e.from) && !ids.has(e.to)),
      }));
      setSelectedIds([]);
      setSelection(null);
      return;
    }
    if (!selection) return;
    if (selection.type === "node") {
      const id = selection.id;
      mutate((cur) => ({
        resources: cur.resources.filter((r) => r.id !== id),
        relationships: cur.relationships.filter((e) => e.from !== id && e.to !== id),
      }));
    } else {
      const id = selection.id;
      mutate((cur) => ({ relationships: cur.relationships.filter((e) => e.id !== id) }));
    }
    setSelection(null);
    setSelectedIds([]);
  }, [selectedIds, selection, mutate]);

  /** Live position update during drag — not committed to history here. */
  const updateResourcePosition = useCallback((id: string, pos: { x: number; y: number }) => {
    const cur = liveRef.current;
    const nextResources = cur.resources.map((r) => {
      if (r.id !== id) return r;
      const prev = r.position ?? { x: 0, y: 0, ...DEFAULT_NODE_SIZE };
      return { ...r, position: { ...prev, x: pos.x, y: pos.y } };
    });
    liveRef.current = { ...cur, resources: nextResources };
    setResources(nextResources);
  }, []);

  /**
   * Live batch position update during a group drag — not committed here (the
   * single history entry is recorded at drag end via {@link commitCurrentState}).
   */
  const updateResourcePositions = useCallback((updates: { id: string; x: number; y: number }[]) => {
    if (updates.length === 0) return;
    const byId = new Map(updates.map((u) => [u.id, u]));
    const cur = liveRef.current;
    const nextResources = cur.resources.map((r) => {
      const u = byId.get(r.id);
      if (!u) return r;
      const prev = r.position ?? { x: 0, y: 0, ...DEFAULT_NODE_SIZE };
      return { ...r, position: { ...prev, x: u.x, y: u.y } };
    });
    liveRef.current = { ...cur, resources: nextResources };
    setResources(nextResources);
  }, []);

  /** Replace the collapsed-container set (e.g. the High-level view preset). */
  const setCollapsedIds = useCallback((ids: Iterable<string>) => {
    setCollapsed(new Set(ids));
  }, []);

  /** Toggle a container's collapsed state (view-only). */
  const toggleCollapsed = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // ---- layer / filter / overlay setters (view-only) ----
  const toggleCategory = useCallback((id: ServiceCategoryId) => {
    setHiddenCategories((prev) => toggledSet(prev, id));
  }, []);
  const toggleRelClass = useCallback((id: RelationshipClass) => {
    setHiddenRelClasses((prev) => toggledSet(prev, id));
  }, []);
  /** Expand/collapse a summarized leaf group by its `${parentId}::${serviceId}` key. */
  const toggleExpandedGroup = useCallback((key: string) => {
    setExpandedGroups((prev) => toggledSet(prev, key));
  }, []);
  /** Apply a full layer state at once (view presets, saved views). */
  const setLayers = useCallback((layers: LayerState) => {
    setHiddenCategories(new Set(layers.hiddenCategories));
    setHiddenRelClasses(new Set(layers.hiddenRelClasses));
    setFilterMode(layers.filterMode);
    setEnvironmentTint(layers.environmentTint);
  }, []);

  /**
   * Reparent a node (drag-in/out). `parentId` undefined makes it a free
   * top-level node placed at `dropPos`. Committed as one history entry.
   */
  const setParent = useCallback(
    (id: string, parentId: string | undefined, dropPos?: { x: number; y: number }) => {
      mutate((cur) => ({
        resources: cur.resources.map((r) => {
          if (r.id !== id) return r;
          const next: ResourceInstance = { ...r, parentId: parentId || undefined };
          if (!parentId && dropPos) {
            const prevPos = r.position ?? { x: 0, y: 0, ...DEFAULT_NODE_SIZE };
            next.position = { ...prevPos, x: dropPos.x, y: dropPos.y };
          }
          return next;
        }),
      }));
    },
    [mutate],
  );

  /** Inspector field writes: name / region / config[key]. Committed. */
  const updateResource = useCallback(
    (id: string, patch: { name?: string; region?: string; config?: Record<string, unknown> }) => {
      mutate((cur) => ({
        resources: cur.resources.map((r) => {
          if (r.id !== id) return r;
          const next: ResourceInstance = { ...r };
          if (patch.name !== undefined) next.name = patch.name;
          if (patch.region !== undefined) next.region = patch.region || undefined;
          if (patch.config) next.config = { ...r.config, ...patch.config };
          return next;
        }),
      }));
      // The selection's cached `resource` is refreshed by the effect in
      // useFlow once the new `resources` array is committed.
    },
    [mutate],
  );

  const updateRelationshipKind = useCallback(
    (id: string, kind: RelationshipKind) => {
      mutate((cur) => ({
        relationships: cur.relationships.map((e) => (e.id === id ? { ...e, kind } : e)),
      }));
    },
    [mutate],
  );

  const connect = useCallback(
    (fromId: string, toId: string, kind: RelationshipKind = "connects_to") => {
      if (fromId === toId) return;
      const id = uid();
      const rel: Relationship = { id, from: fromId, to: toId, kind, source: "manual" };
      const next = mutate((cur) => ({ relationships: [...cur.relationships, rel] }));
      setSelection(edgeSelection(rel, next.resources));
      setSelectedIds([]);
    },
    [mutate, uid],
  );

  const duplicateSelection = useCallback(() => {
    if (!selection || selection.type !== "node") return;
    const r = liveRef.current.resources.find((x) => x.id === selection.id);
    if (!r) return;
    const id = uid();
    const pos = r.position ?? { x: 0, y: 0, ...DEFAULT_NODE_SIZE };
    const copy: ResourceInstance = {
      ...r,
      id,
      config: { ...r.config },
      position: { ...pos, x: pos.x + 24, y: pos.y + 24 },
      source: "manual",
    };
    mutate((cur) => ({ resources: [...cur.resources, copy] }));
    setSelection(nodeSelection(copy));
    setSelectedIds([id]);
  }, [selection, mutate, uid]);

  /** Add a containing VPC around the selected node. */
  const groupIntoVPC = useCallback(() => {
    if (!selection || selection.type !== "node") return;
    const r = liveRef.current.resources.find((x) => x.id === selection.id);
    if (!r) return;
    const pos = r.position ?? { x: 0, y: 0, ...DEFAULT_NODE_SIZE };
    addResource("vpc", pos.x - 80, pos.y - 80);
  }, [selection, addResource]);

  const clear = useCallback(() => {
    if (typeof confirm === "function" && !confirm("Clear canvas?")) return;
    mutate(() => ({ resources: [], relationships: [] }));
    setSelection(null);
    setSelectedIds([]);
    setCollapsed(new Set());
    setExpandedGroups(new Set());
    setSearchMatches(new Set());
    setFocusedContainerId(null);
    setDragOverride(null);
  }, [mutate]);

  /** Replace the entire model (import / preset / server load). */
  const replaceAll = useCallback(
    (next: {
      resources: ResourceInstance[];
      relationships: Relationship[];
      viewport?: Viewport;
      accounts?: Account[];
      graphId?: string;
    }) => {
      mutate((cur) => ({
        resources: next.resources,
        relationships: next.relationships,
        viewport: next.viewport ?? { ...DEFAULT_VIEWPORT },
        accounts: next.accounts ?? [],
        graphId: next.graphId ?? cur.graphId,
      }));
      setSelection(null);
      setSelectedIds([]);
      setCollapsed(new Set());
      setExpandedGroups(new Set());
      setSearchMatches(new Set());
      setFocusedContainerId(null);
      setDragOverride(null);
    },
    [mutate],
  );

  /** Commit the current live state to history (e.g. at the END of a drag). */
  const commitCurrentState = useCallback(() => {
    record({ ...liveRef.current });
  }, [record]);

  // Viewport pan/zoom: keep the live mirror in sync. Viewport changes are not
  // independently committed (they ride along with the next structural commit).
  const setViewportSynced = useCallback((vp: Viewport) => {
    liveRef.current = { ...liveRef.current, viewport: vp };
    setViewport(vp);
  }, []);

  // Read the live viewport synchronously. Rapid wheel/pinch/momentum events can
  // fire several times before React re-renders, so handlers that chain off the
  // current viewport must read the mirror (updated in `setViewportSynced`)
  // rather than the closed-over React state to avoid dropping deltas.
  const getViewport = useCallback(() => liveRef.current.viewport, []);

  // Keep graphId in the live mirror when set directly (e.g. after a save).
  const setGraphIdSynced = useCallback((id: string) => {
    liveRef.current = { ...liveRef.current, graphId: id };
    setGraphId(id);
  }, []);

  return {
    // State
    resources,
    relationships,
    viewport,
    accounts,
    mode,
    density,
    collapsed,
    focusedContainerId,
    dragOverride,
    hiddenCategories,
    hiddenRelClasses,
    filterMode,
    environmentTint,
    edgeStyle,
    searchMatches,
    presentation,
    activeOverlay,
    expandedGroups,
    selection,
    selectedIds,
    graphId,

    // Setters
    setViewport: setViewportSynced,
    getViewport,
    setMode,
    setDensity,
    toggleCollapsed,
    setCollapsedIds,
    setFocusedContainerId,
    setDragOverride,
    setParent,
    toggleCategory,
    toggleRelClass,
    toggleExpandedGroup,
    setFilterMode,
    setEnvironmentTint,
    setEdgeStyle,
    setSearchMatches,
    setPresentation,
    setActiveOverlay,
    setLayers,
    setSelection,
    setSelectedIds,
    setGraphId: setGraphIdSynced,

    // Actions
    addResource,
    removeSelection,
    updateResource,
    updateResourcePosition,
    updateResourcePositions,
    updateRelationshipKind,
    connect,
    duplicateSelection,
    groupIntoVPC,
    clear,
    replaceAll,

    // History
    undo: undoAction,
    redo: redoAction,
    canUndo,
    canRedo,
    commitCurrentState,

    // Utilities
    uid,
  };
}
