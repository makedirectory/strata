"use client";
import { useRef, useCallback } from "react";
import type { ResourceInstance } from "../aws/model";
import type { RelationshipKind } from "../aws/types";
import type { CanvasMode, Pan } from "../types";
import { getService } from "../aws/registry";
import {
  zoomAbout,
  computeSnap,
  normalizeRect,
  nodesInRect,
  screenToWorld as toWorld,
  worldToScreen,
  screenDeltaToWorld,
  type Vec2,
  type Rect,
  type GuideLine,
} from "../canvas/geometry";

/** Wheel-zoom sensitivity: factor = exp(-deltaY * k). Smooth for pinch + ⌘-wheel. */
const ZOOM_SENSITIVITY = 0.0015;

/** Smallest a node may be resized to (world units), and the resize step. */
const MIN_NODE_W = 120;
const MIN_NODE_H = 60;
const RESIZE_STEP = 8;

/** An in-progress corner resize of a single node. */
interface ResizeState {
  id: string;
  startW: number;
  startH: number;
  startClientX: number;
  startClientY: number;
}

/** An in-progress node drag — one node (single) or many (group), unified. */
interface DragState {
  /** The node under the pointer; its snap drives the group delta. */
  anchorId: string;
  /** All moving node ids (length 1 for a single drag). */
  ids: string[];
  /** Initial top-left (effective rect) of each moving node, keyed by id. */
  start: Map<string, Vec2>;
  /** Screen-space offset of the pointer from the anchor's top-left at grab. */
  grabDX: number;
  grabDY: number;
  /** True when the drag began on a node that was part of a multi-selection. */
  isGroup: boolean;
  /** The dragged node already had a parent — a child drag uses the layout override. */
  wasChild: boolean;
  /** Moving ids that are nested (have a parentId). In a group drag their on-canvas
   *  placement is owned by the layout engine, so we must NOT write their stored
   *  position (doing so corrupts the coordinate the node falls back to once
   *  un-nested / its container removed). */
  childIds: Set<string>;
  /** Latest snapped top-left of the anchor (for drop reparent / free placement). */
  lastX: number;
  lastY: number;
  /** Latest pointer position in world coords (for drop-into-container targeting). */
  lastPointerX: number;
  lastPointerY: number;
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
  const resizeRef = useRef<ResizeState | null>(null);
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
        rects: Map<string, Rect>;
        readOnly: boolean;
        connect: (from: string, to: string, kind: RelationshipKind) => void;
        selectSingle: (id: string) => void;
      },
    ) => {
      e.preventDefault();
      e.stopPropagation();
      const { pan, mode, resources, selectedIds, rects, readOnly, connect, selectSingle } = ctx;
      // Presentation / read-only: select for inspection, but never drag or wire.
      if (readOnly) {
        selectSingle(resource.id);
        return;
      }
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

      // Grab from the EFFECTIVE (laid-out) rect so a nested node doesn't jump.
      const p = rects.get(resource.id) ?? { x: 0, y: 0, w: 0, h: 0 };
      const start = new Map<string, Vec2>();
      for (const id of ids) {
        const rb = rects.get(id);
        if (rb) start.set(id, { x: rb.x, y: rb.y });
      }
      const parentById = new Map(resources.map((r) => [r.id, r.parentId]));
      const childIds = new Set(ids.filter((id) => !!parentById.get(id)));
      // Screen-space offset of the pointer from the anchor's top-left at grab,
      // via the shared forward projection (single source of truth with overlays).
      const anchorScreen = worldToScreen({ x: p.x, y: p.y }, pan);
      dragRef.current = {
        anchorId: resource.id,
        ids,
        start,
        grabDX: e.clientX - anchorScreen.x,
        grabDY: e.clientY - anchorScreen.y,
        isGroup,
        wasChild: !!resource.parentId,
        childIds,
        lastX: p.x,
        lastY: p.y,
        lastPointerX: p.x + p.w / 2,
        lastPointerY: p.y + p.h / 2,
      };
      draggedRef.current = false;
    },
    [defaultKind],
  );

  /** Begin a corner resize of a single node. Mirrors onNodeMouseDown's grab but
   *  drives node size (position.w/h) instead of position. */
  const onResizeStart = useCallback(
    (
      e: React.MouseEvent,
      resource: ResourceInstance,
      ctx: { rects: Map<string, Rect>; readOnly: boolean; selectSingle: (id: string) => void },
    ) => {
      e.preventDefault();
      e.stopPropagation();
      if (ctx.readOnly) return;
      ctx.selectSingle(resource.id);
      const rect = ctx.rects.get(resource.id);
      resizeRef.current = {
        id: resource.id,
        startW: rect?.w ?? resource.position?.w ?? 240,
        startH: rect?.h ?? resource.position?.h ?? 100,
        startClientX: e.clientX,
        startClientY: e.clientY,
      };
      draggedRef.current = false;
    },
    [],
  );

  const onCanvasMouseDown = useCallback(
    (
      e: React.MouseEvent,
      ctx: {
        pan: Pan;
        mode: CanvasMode;
        readOnly: boolean;
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
      // Presentation / read-only: pan only; an empty click clears selection.
      if (ctx.readOnly) {
        ctx.clearSelection();
        return;
      }
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
        rects: Map<string, Rect>;
        pan: Pan;
        /** Live viewport accessor — read per-event so incremental panning never
         *  accumulates against a stale, closed-over `pan`. */
        getPan: () => Pan;
        updatePositions: (updates: { id: string; x: number; y: number }[]) => void;
        updateSize: (id: string, size: { w: number; h: number }) => void;
        updatePan: (newPan: Pan) => void;
        setGuides: (guides: GuideLine[]) => void;
        setMarquee: (rect: Rect | null) => void;
        setOverride: (o: { id: string; x: number; y: number } | null) => void;
      },
    ) => {
      const {
        rects,
        pan,
        getPan,
        updatePositions,
        updateSize,
        updatePan,
        setGuides,
        setMarquee,
        setOverride,
      } = ctx;
      // A corner resize takes priority over drag/marquee/pan.
      const resize = resizeRef.current;
      if (resize) {
        const round = (v: number) => Math.round(v / RESIZE_STEP) * RESIZE_STEP;
        // Screen-pixel drag delta → world units via the shared conversion.
        const d = screenDeltaToWorld(
          e.clientX - resize.startClientX,
          e.clientY - resize.startClientY,
          pan.scale,
        );
        const w = Math.max(MIN_NODE_W, round(resize.startW + d.x));
        const h = Math.max(MIN_NODE_H, round(resize.startH + d.y));
        draggedRef.current = true;
        updateSize(resize.id, { w, h });
        return;
      }
      const drag = dragRef.current;
      if (drag) {
        const box = rects.get(drag.anchorId);
        const startAnchor = drag.start.get(drag.anchorId);
        if (!box || !startAnchor) return;
        const nx = (e.clientX - pan.x - drag.grabDX) / pan.scale;
        const ny = (e.clientY - pan.y - drag.grabDY) / pan.scale;
        // Snap the anchor to the visible grid + other nodes' edges/centres
        // (excluding the moving set). Threshold ≈8 screen px in world units.
        const moving = new Set(drag.ids);
        const others = [...rects.entries()].filter(([id]) => !moving.has(id)).map(([, r]) => r);
        const snap = computeSnap({ x: nx, y: ny, w: box.w, h: box.h }, others, {
          threshold: 8 / pan.scale,
        });
        draggedRef.current = true;
        drag.lastX = snap.x;
        drag.lastY = snap.y;
        // Track the raw cursor in world coords so drop-to-reparent targets the
        // container under the pointer (more reliable for deep nesting into a
        // small container than the dragged node's centre).
        drag.lastPointerX = (e.clientX - pan.x) / pan.scale;
        drag.lastPointerY = (e.clientY - pan.y) / pan.scale;
        if (drag.isGroup) {
          // Move every selected TOP-LEVEL node together (stored positions).
          // Nested members are skipped: the layout engine owns their placement
          // (they move because their container moves), and writing their stored
          // x/y here would corrupt the coordinate they fall back to when later
          // un-nested or their container is deleted.
          const ddx = snap.x - startAnchor.x;
          const ddy = snap.y - startAnchor.y;
          updatePositions(
            drag.ids
              .filter((id) => !drag.childIds.has(id))
              .map((id) => {
                const s = drag.start.get(id) ?? { x: 0, y: 0 };
                return { id, x: s.x + ddx, y: s.y + ddy };
              }),
          );
        } else if (drag.wasChild) {
          // A child detaches via the layout override and follows the cursor; its
          // former parent repacks. Reparent happens on drop.
          setOverride({ id: drag.anchorId, x: snap.x, y: snap.y });
        } else {
          // A free top-level node moves its stored position directly.
          updatePositions([{ id: drag.anchorId, x: snap.x, y: snap.y }]);
        }
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
        // Read the live viewport (not the closed-over `pan`) so consecutive
        // native mousemove events within one render frame each accumulate their
        // delta instead of all overwriting the same stale base.
        const cur = getPan();
        updatePan({ ...cur, x: cur.x + e.movementX, y: cur.y + e.movementY });
      }
    },
    [],
  );

  const onMouseUp = useCallback(
    (ctx: {
      rects: Map<string, Rect>;
      commitState: () => void;
      selectSingle: (id: string) => void;
      applyMarquee: (ids: string[]) => void;
      clearSelection: () => void;
      setGuides: (guides: GuideLine[]) => void;
      setMarquee: (rect: Rect | null) => void;
      setOverride: (o: { id: string; x: number; y: number } | null) => void;
      /** Deepest visible container under a world point, excluding a subtree. */
      containerAt: (point: Vec2, excludeId: string) => string | null;
      setParent: (id: string, parentId: string | undefined, dropPos?: Vec2) => void;
    }) => {
      // End a corner resize: commit one history entry if the size actually changed.
      const resize = resizeRef.current;
      if (resize) {
        if (draggedRef.current) ctx.commitState();
        resizeRef.current = null;
        draggedRef.current = false;
        return;
      }
      const drag = dragRef.current;
      if (drag) {
        if (draggedRef.current) {
          const box = ctx.rects.get(drag.anchorId);
          if (drag.isGroup) {
            // Group move → one history entry; no reparenting.
            ctx.commitState();
          } else {
            // Single drag: reparent based on the container under the cursor
            // (falls back to the node centre if no pointer was recorded).
            const point = {
              x: drag.lastPointerX || drag.lastX + (box?.w ?? 0) / 2,
              y: drag.lastPointerY || drag.lastY + (box?.h ?? 0) / 2,
            };
            const target = ctx.containerAt(point, drag.anchorId);
            if (target) {
              ctx.setParent(drag.anchorId, target);
            } else if (drag.wasChild) {
              // Dropped on empty canvas → becomes a free top-level node there.
              ctx.setParent(drag.anchorId, undefined, { x: drag.lastX, y: drag.lastY });
            } else {
              // Stayed a free top-level node → just commit the moved position.
              ctx.commitState();
            }
          }
        } else if (drag.isGroup) {
          // A click (no move) on a member of a multi-selection collapses to it.
          ctx.selectSingle(drag.anchorId);
        }
        ctx.setOverride(null);
        dragRef.current = null;
        draggedRef.current = false;
        ctx.setGuides([]);
      }
      const m = marqueeRef.current;
      if (m) {
        if (m.moved) {
          const boxes = [...ctx.rects.entries()].map(([id, r]) => ({
            id,
            x: r.x,
            y: r.y,
            w: r.w,
            h: r.h,
          }));
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

  const center = useCallback((pan: Pan, updatePan: (newPan: Pan) => void) => {
    updatePan({ ...pan, x: 200, y: 120 });
  }, []);

  return {
    onNodeMouseDown,
    onResizeStart,
    onCanvasMouseDown,
    onMouseMove,
    onMouseUp,
    onWheelZoom,
    setSpacePressed,
    onConnect,
    screenToWorld,
    center,
  };
}
