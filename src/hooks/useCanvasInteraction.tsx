"use client";
import { useRef, useCallback } from "react";
import type { ResourceInstance } from "../aws/model";
import type { RelationshipKind } from "../aws/types";
import type { CanvasMode, Pan } from "../types";
import { getService } from "../aws/registry";
import { DEFAULT_NODE_SIZE } from "../aws/model";

function pos(r: ResourceInstance) {
  return r.position ?? { x: 0, y: 0, ...DEFAULT_NODE_SIZE };
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
    (pt: { x: number; y: number }, pan: Pan) => ({
      x: (pt.x - pan.x) / pan.scale,
      y: (pt.y - pan.y) / pan.scale,
    }),
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
    if (e.ctrlKey || e.metaKey) {
      // Caller attaches this via a non-passive listener so preventDefault
      // actually blocks the page from zooming/scrolling.
      e.preventDefault();
      const scale = pan.scale * (e.deltaY < 0 ? 1.1 : 0.9);
      const clamped = Math.min(2.0, Math.max(0.4, scale));
      updatePan({ ...pan, scale: clamped });
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
      worldRef: React.RefObject<HTMLDivElement>,
      updatePan: (newPan: Pan) => void,
    ) => {
      if (resources.length === 0) {
        updatePan({ x: 200, y: 120, scale: 1 });
        return;
      }
      const ps = resources.map(pos);
      const minx = Math.min(...ps.map((p) => p.x));
      const miny = Math.min(...ps.map((p) => p.y));
      const maxx = Math.max(...ps.map((p) => p.x + p.w));
      const maxy = Math.max(...ps.map((p) => p.y + p.h));
      const worldW = maxx - minx;
      const worldH = maxy - miny;

      const view = (worldRef.current!.parentElement as HTMLElement).getBoundingClientRect();
      const margin = 80;
      const sx = (view.width - margin * 2) / worldW;
      const sy = (view.height - margin * 2) / worldH;
      const scale = Math.max(0.4, Math.min(1.6, Math.min(sx, sy)));
      const centerX = (view.width - worldW * scale) / 2 - minx * scale;
      const centerY = (view.height - worldH * scale) / 2 - miny * scale;

      updatePan({ x: centerX, y: centerY, scale });
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
