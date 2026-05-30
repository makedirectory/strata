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
  screenToWorld as toWorld,
  type Vec2,
} from "../canvas/geometry";

/** Wheel-zoom sensitivity: factor = exp(-deltaY * k). Smooth for pinch + ⌘-wheel. */
const ZOOM_SENSITIVITY = 0.0015;

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
  const dragRef = useRef<{ id: string; dx: number; dy: number } | null>(null);
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
      pan: Pan,
      mode: CanvasMode,
      resources: ResourceInstance[],
      connectAction: (from: string, to: string, kind: RelationshipKind) => void,
    ) => {
      e.preventDefault();
      e.stopPropagation();
      // In "connect" mode, clicking nodes wires them: first click picks the
      // source, second click on a different node creates the relationship.
      if (mode === "connect") {
        if (!connectStartRef.current) {
          connectStartRef.current = resource.id;
        } else if (connectStartRef.current !== resource.id) {
          const from = resources.find((r) => r.id === connectStartRef.current);
          connectAction(connectStartRef.current, resource.id, defaultKind(from, resource));
          connectStartRef.current = null;
        }
        return;
      }
      // "move" mode: begin a drag. History is committed once at drag END
      // (onMouseUp), not here, so a click-without-move records no undo step.
      const p = pos(resource);
      const dx = e.clientX - (pan.x + p.x * pan.scale);
      const dy = e.clientY - (pan.y + p.y * pan.scale);
      dragRef.current = { id: resource.id, dx, dy };
      draggedRef.current = false;
    },
    [defaultKind],
  );

  const onCanvasMouseDown = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const isNode = target.closest(".node") !== null;
    const isPort = target.closest(".port") !== null;
    if (isNode || isPort) return;
    if (e.button === 1 || (e.button === 0 && spacePressed.current)) {
      panningRef.current = true;
      e.preventDefault();
    }
  }, []);

  const onMouseMove = useCallback(
    (
      e: MouseEvent,
      resources: ResourceInstance[],
      pan: Pan,
      updatePosition: (id: string, pos: { x: number; y: number }) => void,
      updatePan: (newPan: Pan) => void,
    ) => {
      if (dragRef.current) {
        const r = resources.find((r) => r.id === dragRef.current!.id);
        if (!r) return;
        const nx = (e.clientX - pan.x - dragRef.current.dx) / pan.scale;
        const ny = (e.clientY - pan.y - dragRef.current.dy) / pan.scale;
        draggedRef.current = true;
        updatePosition(r.id, {
          x: Math.round(nx / 4) * 4,
          y: Math.round(ny / 4) * 4,
        });
      } else if (panningRef.current) {
        updatePan({
          ...pan,
          x: pan.x + e.movementX,
          y: pan.y + e.movementY,
        });
      }
    },
    [],
  );

  const onMouseUp = useCallback((commitState?: () => void) => {
    // Only record history when the node was actually moved, not on a bare click.
    if (dragRef.current && draggedRef.current && commitState) commitState();
    draggedRef.current = false;
    dragRef.current = null;
    panningRef.current = false;
  }, []);

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
