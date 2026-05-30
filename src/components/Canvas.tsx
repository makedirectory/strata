"use client";
import React, { useEffect } from "react";
import { useFlow } from "../hooks/useFlow";
import { PALETTE_ADD_EVENT } from "./Palette";

export const Canvas: React.FC = () => {
  const {
    worldRef,
    svgRef,
    minimapRef,
    addResourceFromPalette,
    select,
    onWheelZoom,
    onMouseMove,
    onMouseUp,
    onCanvasMouseDown,
    onCanvasClick,
    draw,
    drawMinimap,
    state,
    toggleMode,
    removeSelection,
    duplicateSelection,
    groupIntoVPC,
    setSpacePressed,
    zoomIn,
    zoomOut,
    zoomReset,
    zoomToSelection,
    fitToView,
  } = useFlow();

  // Drag and drop — scoped to the canvas element so drops elsewhere in the
  // window (e.g. over the palette or inspector) are not swallowed.
  useEffect(() => {
    const el = worldRef.current?.parentElement; // .canvas-wrap
    if (!el) return;
    const onDragOver = (e: DragEvent) => {
      e.preventDefault();
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      const raw = e.dataTransfer?.getData("application/json");
      if (!raw) return;
      try {
        const item: unknown = JSON.parse(raw);
        if (
          item &&
          typeof item === "object" &&
          "serviceId" in item &&
          typeof (item as { serviceId: unknown }).serviceId === "string"
        ) {
          // Convert window coords to canvas-wrap-local coords before passing to
          // screenToWorld (which only undoes pan/scale relative to that origin).
          const rect = el.getBoundingClientRect();
          addResourceFromPalette(
            (item as { serviceId: string }).serviceId,
            e.clientX - rect.left,
            e.clientY - rect.top,
          );
        }
      } catch (err) {
        console.error("Canvas: failed to parse drag-and-drop payload", err);
      }
    };
    el.addEventListener("dragover", onDragOver);
    el.addEventListener("drop", onDrop);
    return () => {
      el.removeEventListener("dragover", onDragOver);
      el.removeEventListener("drop", onDrop);
    };
  }, [addResourceFromPalette, worldRef]);

  // Keyboard/click activation from the Palette: add the service near the
  // centre of the canvas viewport.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ serviceId?: unknown }>).detail;
      if (!detail || typeof detail.serviceId !== "string") return;
      const el = worldRef.current?.parentElement;
      const rect = el?.getBoundingClientRect();
      // canvas-wrap-local centre (screenToWorld undoes pan/scale from this origin).
      const x = rect ? rect.width / 2 : window.innerWidth / 2;
      const y = rect ? rect.height / 2 : window.innerHeight / 2;
      addResourceFromPalette(detail.serviceId, x, y);
    };
    window.addEventListener(PALETTE_ADD_EVENT, handler);
    return () => window.removeEventListener(PALETTE_ADD_EVENT, handler);
  }, [addResourceFromPalette, worldRef]);

  // Redraw when state changes
  useEffect(() => {
    draw();
    drawMinimap();
  }, [state.resources, state.relationships, state.viewport, state.mode, draw, drawMinimap]);

  // Mouse events
  useEffect(() => {
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [onMouseMove, onMouseUp]);

  // Wheel zoom — attach a NON-passive listener so preventDefault() actually
  // blocks the browser's page zoom/scroll (React's onWheel is passive).
  useEffect(() => {
    const el = worldRef.current?.parentElement; // .canvas-wrap
    if (!el) return;
    el.addEventListener("wheel", onWheelZoom, { passive: false });
    return () => el.removeEventListener("wheel", onWheelZoom);
  }, [onWheelZoom, worldRef]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const ae = document.activeElement as HTMLElement | null;
      const tag = ae?.tagName?.toLowerCase();
      const typing =
        ae && (tag === "input" || tag === "textarea" || tag === "select" || ae.isContentEditable);
      if (typing) return;

      if (e.code === "Space") {
        document.body.style.cursor = "grab";
        setSpacePressed(true);
      }
      // Ignore single-key shortcuts when a modifier is held so we don't hijack
      // browser/OS shortcuts (⌘C, Ctrl+D, ⌘G, etc.).
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "c" || e.key === "C") toggleMode();
      if (e.key === "Delete" || e.key === "Backspace") removeSelection();
      if (e.key === "d" || e.key === "D") duplicateSelection();
      if (e.key === "g" || e.key === "G") groupIntoVPC();
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        document.body.style.cursor = "default";
        setSpacePressed(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [toggleMode, removeSelection, duplicateSelection, groupIntoVPC, setSpacePressed]);

  return (
    <>
      <svg className="edges" ref={svgRef} aria-hidden="true" />
      {/* Pointer-only canvas surface; node interactions are delivered via the
          renderer's per-node handlers, so these layers are aria-hidden. */}
      <div
        className="world"
        ref={worldRef}
        aria-hidden="true"
        onClick={() => select(null)}
        onMouseDown={onCanvasMouseDown}
      />
      <div className="overlay" aria-hidden="true" onClick={onCanvasClick} />
      {state.resources.length === 0 && (
        <div className="empty-hint" aria-hidden="true">
          <div className="empty-hint-title">Nothing here yet</div>
          <div className="empty-hint-sub">
            Drag a service from the palette, load a preset, or Import IaC.
          </div>
        </div>
      )}
      <div className="zoom-controls" role="group" aria-label="Zoom controls">
        <button type="button" onClick={zoomIn} title="Zoom in">
          +
        </button>
        <button type="button" onClick={zoomOut} title="Zoom out">
          −
        </button>
        <button type="button" className="zoom-level" onClick={zoomReset} title="Reset to 100%">
          {Math.round(state.viewport.scale * 100)}%
        </button>
        <button type="button" onClick={fitToView} title="Fit all to view">
          Fit
        </button>
        <button type="button" onClick={zoomToSelection} title="Zoom to selection">
          ⤢
        </button>
      </div>
      <div className="minimap">
        <canvas ref={minimapRef} aria-hidden="true" />
      </div>
    </>
  );
};
