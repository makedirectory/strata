"use client";
import { useRef, useCallback } from "react";
import type { ResourceInstance } from "../aws/model";
import type { RelationshipKind } from "../aws/types";
import type { CanvasMode, Pan } from "../types";
import { getService } from "../aws/registry";
import { DEFAULT_NODE_SIZE } from "../aws/model";
import {
  zoomAbout,
  fitView,
  boundsOf,
  computeSnap,
  normalizeRect,
  nodesInRect,
  screenToWorld as toWorld,
  type Vec2,
  type Rect,
  type GuideLine,
} from "../canvas/geometry";

/** Wheel-zoom sensitivity: factor = exp(-deltaY * k). Smooth for pinch + ⌘-wheel. */
const ZOOM_SENSITIVITY = 0.0015;

/** An in-progress node drag — one node (single) or many (group), unified. */
interface DragState {
  /** The node under the pointer; its snap drives the group delta. */
  anchorId: string;
  /** All moving node ids (length 1 for a single drag). */
  ids: string[];
  /** Initial top-left of each moving node, keyed by id. */
  start: Map<string, Vec2>;
  /** Screen-space offset of the pointer from the anchor's top-left at grab. */
  grabDX: number;
  grabDY: number;
  /** True when the drag began on a node that was part of a multi-selection. */
  isGroup: boolean;
}

/** An in-progress marquee selection rectangle. */
interface MarqueeState {
  startWorld: Vec2;
  /** Canvas-wrap origin in client coords, captured at press (pan is fixed during). */
  originLeft: number;
  originTop: number;
  rectWorld: Rect;
  moved: boolean;
}

function pos(r: ResourceInstance) {
  return r.position ?? { x: 0, y: 0, ...DEFAULT_NODE_SIZE };
}

/** Canvas-wrap-local pointer coordinates for a native event (subtract the rect). */
function localPoint(e: {
  clientX: number;
  clientY: number;
  currentTarget: EventTarget | null;
}): Vec2 {
  const el = e.currentTarget as HTMLElement | null;
  const rect = el?.getBoundingClientRect();
  return { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) };
}

export function useCanvasInteraction() {
  const dragRef = useRef<DragState | null>(null);
  const marqueeRef = useRef<MarqueeState | null>(null);
  // Tracks whether the active drag actually moved the node, so a plain click
  // (mousedown + mouseup with no movement) records no history step.
  const draggedRef = useRef(false);
  const panningRef = useRef(false);
  const spacePressed = useRef(false);
  const connectStartRef = useRef<string | null>(null);

  const screenToWorld = useCallback(
    (pt: { x: number; y: number }, pan: Pan) => toWorld(pt, pan),
    [],
  );

  /** Resolve the default relationship kind from the source service's commonConnections. */
  const defaultKind = useCallback(
    (fromResource?: ResourceInstance, toResource?: ResourceInstance): RelationshipKind => {
      if (!fromResource || !toResource) return "connects_to";
      const svc = getService(fromResource.serviceId);
      const match = svc?.commonConnections.find((c) => c.to === toResource.serviceId);
      return match?.relationship ?? "connects_to";
    },
    [],
  );

  const onNodeMouseDown = useCallback(
    (
      e: React.MouseEvent,
      resource: ResourceInstance,
      ctx: {
        pan: Pan;
        mode: CanvasMode;
        resources: ResourceInstance[];
        selectedIds: string[];
        connect: (from: string, to: string, kind: RelationshipKind) => void;
        selectSingle: (id: string) => void;
      },
    ) => {
      e.preventDefault();
      e.stopPropagation();
      const { pan, mode, resources, selectedIds, connect, selectSingle } = ctx;
      // In "connect" mode, clicking nodes wires them: first click picks the
      // source, second click on a different node creates the relationship.
      if (mode === "connect") {
        if (!connectStartRef.current) {
          connectStartRef.current = resource.id;
        } else if (connectStartRef.current !== resource.id) {
          const from = resources.find((r) => r.id === connectStartRef.current);
          connect(connectStartRef.current, resource.id, defaultKind(from, resource));
          connectStartRef.current = null;
        }
        selectSingle(resource.id);
        return;
      }
      // "move" mode: begin a drag. History is committed once at drag END
      // (onMouseUp), not here, so a click-without-move records no undo step.
      // Pressing a node that is part of a multi-selection drags the whole group
      // (and preserves the selection); pressing any other node selects just it.
      const isGroup = selectedIds.length > 1 && selectedIds.includes(resource.id);
      const ids = isGroup ? [...selectedIds] : [resource.id];
      if (!isGroup) selectSingle(resource.id);

      const p = pos(resource);
      const start = new Map<string, Vec2>();
      for (const id of ids) {
        const r = resources.find((x) => x.id === id);
        if (r) {
          const rp = pos(r);
          start.set(id, { x: rp.x, y: rp.y });
        }
      }
      dragRef.current = {
        anchorId: resource.id,
        ids,
        start,
        grabDX: e.clientX - (pan.x + p.x * pan.scale),
        grabDY: e.clientY - (pan.y + p.y * pan.scale),
        isGroup,
      };
      draggedRef.current = false;
    },
    [defaultKind],
  );

  const onCanvasMouseDown = useCallback(
    (
      e: React.MouseEvent,
      ctx: {
        pan: Pan;
        mode: CanvasMode;
        setMarquee: (rect: Rect | null) => void;
        clearSelection: () => void;
      },
    ) => {
      const target = e.target as HTMLElement;
      const isNode = target.closest(".node") !== null;
      const isPort = target.closest(".port") !== null;
      if (isNode || isPort) return;
      // Space+drag or middle-mouse → pan.
      if (e.button === 1 || (e.button === 0 && spacePressed.current)) {
        panningRef.current = true;
        e.preventDefault();
        return;
      }
      if (e.button !== 0) return;
      if (ctx.mode === "connect") {
        // No marquee while wiring; an empty-canvas press just clears selection.
        ctx.clearSelection();
        return;
      }
      // Move mode: begin a marquee selection on empty canvas.
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const startWorld = toWorld({ x: e.clientX - rect.left, y: e.clientY - rect.top }, ctx.pan);
      marqueeRef.current = {
        startWorld,
        originLeft: rect.left,
        originTop: rect.top,
        rectWorld: { x: startWorld.x, y: startWorld.y, w: 0, h: 0 },
        moved: false,
      };
      ctx.setMarquee(marqueeRef.current.rectWorld);
    },
    [],
  );

  const onMouseMove = useCallback(
    (
      e: MouseEvent,
      ctx: {
        resources: ResourceInstance[];
        pan: Pan;
        updatePositions: (updates: { id: string; x: number; y: number }[]) => void;
        updatePan: (newPan: Pan) => void;
        setGuides: (guides: GuideLine[]) => void;
        setMarquee: (rect: Rect | null) => void;
      },
    ) => {
      const { resources, pan, updatePositions, updatePan, setGuides, setMarquee } = ctx;
      const drag = dragRef.current;
      if (drag) {
        const anchor = resources.find((x) => x.id === drag.anchorId);
        const startAnchor = drag.start.get(drag.anchorId);
        if (!anchor || !startAnchor) return;
        const box = pos(anchor);
        const nx = (e.clientX - pan.x - drag.grabDX) / pan.scale;
        const ny = (e.clientY - pan.y - drag.grabDY) / pan.scale;
        // Snap the anchor to the visible grid + other nodes' edges/centres
        // (excluding the moving set). Threshold ≈8 screen px in world units.
        const moving = new Set(drag.ids);
        const others = resources.filter((x) => !moving.has(x.id)).map(pos);
        const snap = computeSnap({ x: nx, y: ny, w: box.w, h: box.h }, others, {
          threshold: 8 / pan.scale,
        });
        // Apply the anchor's snapped delta to every moving node so the group
        // keeps its shape.
        const ddx = snap.x - startAnchor.x;
        const ddy = snap.y - startAnchor.y;
        const updates = drag.ids.map((id) => {
          const s = drag.start.get(id) ?? { x: 0, y: 0 };
          return { id, x: s.x + ddx, y: s.y + ddy };
        });
        draggedRef.current = true;
        updatePositions(updates);
        setGuides(snap.guides);
        return;
      }
      const m = marqueeRef.current;
      if (m) {
        const local = { x: e.clientX - m.originLeft, y: e.clientY - m.originTop };
        const rect = normalizeRect(m.startWorld, toWorld(local, pan));
        m.rectWorld = rect;
        m.moved = rect.w > 3 || rect.h > 3;
        setMarquee(rect);
        return;
      }
      if (panningRef.current) {
        updatePan({ ...pan, x: pan.x + e.movementX, y: pan.y + e.movementY });
      }
    },
    [],
  );

  const onMouseUp = useCallback(
    (ctx: {
      resources: ResourceInstance[];
      commitState: () => void;
      selectSingle: (id: string) => void;
      applyMarquee: (ids: string[]) => void;
      clearSelection: () => void;
      setGuides: (guides: GuideLine[]) => void;
      setMarquee: (rect: Rect | null) => void;
    }) => {
      const drag = dragRef.current;
      if (drag) {
        if (draggedRef.current) {
          // Group/single move → exactly one history entry.
          ctx.commitState();
        } else if (drag.isGroup) {
          // A click (no move) on a member of a multi-selection collapses to it.
          ctx.selectSingle(drag.anchorId);
        }
        dragRef.current = null;
        draggedRef.current = false;
        ctx.setGuides([]);
      }
      const m = marqueeRef.current;
      if (m) {
        if (m.moved) {
          const boxes = ctx.resources.map((r) => {
            const p = pos(r);
            return { id: r.id, x: p.x, y: p.y, w: p.w, h: p.h };
          });
          ctx.applyMarquee(nodesInRect(boxes, m.rectWorld));
        } else {
          // A bare click on empty canvas clears the selection.
          ctx.clearSelection();
        }
        marqueeRef.current = null;
        ctx.setMarquee(null);
      }
      panningRef.current = false;
    },
    [],
  );

  const onWheelZoom = useCallback((e: WheelEvent, pan: Pan, updatePan: (newPan: Pan) => void) => {
    // The caller attaches this via a non-passive listener so preventDefault
    // actually blocks the browser's page zoom/scroll.
    e.preventDefault();
    // ⌘/Ctrl+wheel and trackpad pinch (which reports ctrlKey) → cursor-anchored
    // zoom. Plain wheel / two-finger scroll → pan. This matches pro design tools.
    if (e.ctrlKey || e.metaKey) {
      const factor = Math.exp(-e.deltaY * ZOOM_SENSITIVITY);
      updatePan(zoomAbout(pan, localPoint(e), pan.scale * factor));
    } else {
      updatePan({ ...pan, x: pan.x - e.deltaX, y: pan.y - e.deltaY });
    }
  }, []);

  const setSpacePressed = useCallback((pressed: boolean) => {
    spacePressed.current = pressed;
  }, []);

  const onConnect = useCallback(
    (
      resourceId: string,
      type: "start" | "end",
      resources: ResourceInstance[],
      connectAction: (from: string, to: string, kind: RelationshipKind) => void,
    ) => {
      if (type === "start") {
        connectStartRef.current = resourceId;
      } else if (
        type === "end" &&
        connectStartRef.current &&
        connectStartRef.current !== resourceId
      ) {
        const from = resources.find((r) => r.id === connectStartRef.current);
        const to = resources.find((r) => r.id === resourceId);
        connectAction(connectStartRef.current, resourceId, defaultKind(from, to));
        connectStartRef.current = null;
      }
    },
    [defaultKind],
  );

  const fitToView = useCallback(
    (
      resources: ResourceInstance[],
      worldRef: React.RefObject<HTMLDivElement | null>,
      updatePan: (newPan: Pan) => void,
    ) => {
      if (resources.length === 0) {
        updatePan({ x: 200, y: 120, scale: 1 });
        return;
      }
      const bounds = boundsOf(resources.map(pos));
      if (!bounds) return;
      const view = (worldRef.current!.parentElement as HTMLElement).getBoundingClientRect();
      updatePan(fitView(bounds, { width: view.width, height: view.height }));
    },
    [],
  );

  const center = useCallback((pan: Pan, updatePan: (newPan: Pan) => void) => {
    updatePan({ ...pan, x: 200, y: 120 });
  }, []);

  return {
    onNodeMouseDown,
    onCanvasMouseDown,
    onMouseMove,
    onMouseUp,
    onWheelZoom,
    setSpacePressed,
    onConnect,
    screenToWorld,
    fitToView,
    center,
  };
}
