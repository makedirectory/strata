"use client";
import React, { useEffect, useRef } from "react";
import { useFlow, useFlowCanvas } from "../hooks/useFlow";
import { PALETTE_ADD_EVENT } from "./Palette";

/** Major/minor visible grid steps (world units). Minor matches the snap step. */
const GRID_MAJOR = 80;
const GRID_MINOR = 16;

export const Canvas: React.FC = () => {
  const gridRef = useRef<HTMLDivElement>(null);
  // High-churn canvas slice (re-renders on pan/zoom/drag) — isolated from panels.
  const {
    viewport,
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
  } = useFlowCanvas();
  const {
    worldRef,
    svgRef,
    minimapRef,
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
    onNodeDoubleClick,
    focusContainer,
    breadcrumb,
    focusedContainerId,
    presentation,
    openStartHub,
    findingMarkers,
    costMarkers,
    driftMarkers,
  } = useFlow();

  // Whether a minimap click-drag is in progress (window-level so the drag keeps
  // navigating even when the pointer leaves the small minimap box).
  const minimapDragRef = useRef(false);

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
      if (presentation) return; // read-only: no drops
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
  }, [addResourceFromPalette, worldRef, presentation]);

  // Keyboard/click activation from the Palette: add the service near the
  // centre of the canvas viewport.
  useEffect(() => {
    const handler = (e: Event) => {
      if (presentation) return; // read-only: ignore palette add requests
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
  }, [addResourceFromPalette, worldRef, presentation]);

  // Redraw when state changes
  useEffect(() => {
    draw();
    drawMinimap();
  }, [state.resources, state.relationships, viewport, state.mode, draw, drawMinimap]);

  // Make the visible grid track the viewport so "snap to the visible grid" is
  // honest at any pan/zoom: background-position follows pan, size scales with
  // zoom. The minor (snap-step) grid is dropped once it would be denser than
  // ~8px on screen so far-out zoom does not turn into a solid fill.
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const { x, y, scale } = viewport;
    const major = GRID_MAJOR * scale;
    const minor = GRID_MINOR * scale;
    const images = [
      "linear-gradient(#15203a 2px, transparent 2px)",
      "linear-gradient(90deg, #15203a 2px, transparent 2px)",
    ];
    const sizes = [`${major}px ${major}px`, `${major}px ${major}px`];
    if (minor >= 8) {
      images.push(
        "linear-gradient(#10182c 1px, transparent 1px)",
        "linear-gradient(90deg, #10182c 1px, transparent 1px)",
      );
      sizes.push(`${minor}px ${minor}px`, `${minor}px ${minor}px`);
    }
    el.style.backgroundImage = images.join(", ");
    el.style.backgroundSize = sizes.join(", ");
    el.style.backgroundPosition = images.map(() => `${x}px ${y}px`).join(", ");
  }, [viewport]);

  // Mouse events
  useEffect(() => {
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [onMouseMove, onMouseUp]);

  // Minimap drag-to-navigate: while the pointer is down on the minimap, keep
  // recentring on each move (window listeners so it survives leaving the box).
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (minimapDragRef.current) minimapNavigate(e.clientX, e.clientY);
    };
    const onUp = () => {
      minimapDragRef.current = false;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [minimapNavigate]);

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
      // Read-only / presentation mode gates every editing shortcut.
      if (presentation) return;
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
  }, [
    toggleMode,
    removeSelection,
    duplicateSelection,
    groupIntoVPC,
    setSpacePressed,
    presentation,
  ]);

  return (
    <>
      <div className="grid" ref={gridRef} aria-hidden="true" />
      <svg className="edges" ref={svgRef} aria-hidden="true" />
      {/* Pointer-only canvas surface; node interactions are delivered via the
          renderer's per-node handlers, so these layers are aria-hidden. */}
      <div
        className="world"
        ref={worldRef}
        aria-hidden="true"
        onMouseDown={onCanvasMouseDown}
        onDoubleClick={(e) => {
          const id = (e.target as HTMLElement).closest(".node")?.getAttribute("data-id");
          if (id) onNodeDoubleClick(id);
        }}
      />
      <div className="overlay" aria-hidden="true" />
      {(guides.length > 0 || marquee) && (
        <svg
          className="guides"
          aria-hidden="true"
          style={{
            transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`,
          }}
        >
          {guides.map((g, i) =>
            g.axis === "x" ? (
              <line
                key={i}
                x1={g.pos}
                y1={g.from}
                x2={g.pos}
                y2={g.to}
                className="guide-line"
                vectorEffect="non-scaling-stroke"
              />
            ) : (
              <line
                key={i}
                x1={g.from}
                y1={g.pos}
                x2={g.to}
                y2={g.pos}
                className="guide-line"
                vectorEffect="non-scaling-stroke"
              />
            ),
          )}
          {marquee && (
            <rect
              className="marquee"
              x={marquee.x}
              y={marquee.y}
              width={marquee.w}
              height={marquee.h}
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
      )}
      {findingMarkers.length > 0 && (
        <svg className="findings-overlay" aria-hidden="true">
          {findingMarkers.map((m) => (
            <circle
              key={m.id}
              cx={viewport.x + m.x * viewport.scale}
              cy={viewport.y + m.y * viewport.scale}
              r={6}
              className={
                m.level === "error"
                  ? "finding-dot finding-dot--error"
                  : "finding-dot finding-dot--warn"
              }
            />
          ))}
        </svg>
      )}
      {driftMarkers.length > 0 && (
        <svg className="findings-overlay" aria-hidden="true">
          {driftMarkers.map((m) => (
            <circle
              key={m.id}
              cx={viewport.x + m.x * viewport.scale}
              cy={viewport.y + m.y * viewport.scale}
              r={6}
              className={
                m.status === "added" ? "drift-dot drift-dot--added" : "drift-dot drift-dot--changed"
              }
            />
          ))}
        </svg>
      )}
      {costMarkers.length > 0 && (
        <div className="cost-overlay" aria-hidden="true">
          {costMarkers.map((m) => (
            <span
              key={m.id}
              className="cost-label"
              style={{
                left: viewport.x + m.x * viewport.scale,
                top: viewport.y + m.y * viewport.scale,
              }}
            >
              {m.text}
            </span>
          ))}
        </div>
      )}
      {state.resources.length === 0 && (
        <div className="empty-hint">
          <div className="empty-hint-title">Design your cloud architecture</div>
          <div className="empty-hint-sub">
            Open an example, start from a template, or drag a service from the palette on the left.
            Connect nodes, then use <strong>Tidy</strong> to auto-arrange.
          </div>
          <button className="empty-hint-cta btn-start" onClick={openStartHub}>
            Browse examples & templates
          </button>
        </div>
      )}
      {breadcrumb.length > 0 && (
        <div className="breadcrumb" role="navigation" aria-label="Containment path">
          {breadcrumb.map((c, i) => (
            <React.Fragment key={c.id}>
              {i > 0 && <span className="breadcrumb-sep">▸</span>}
              <button className="breadcrumb-crumb" onClick={() => focusContainer(c.id)}>
                {c.name}
              </button>
            </React.Fragment>
          ))}
          {focusedContainerId && (
            <button
              className="breadcrumb-exit"
              title="Exit focus"
              onClick={() => focusContainer(null)}
            >
              ✕
            </button>
          )}
        </div>
      )}
      <div className="zoom-controls" role="group" aria-label="Zoom controls">
        <button type="button" onClick={zoomIn} title="Zoom in" aria-label="Zoom in">
          +
        </button>
        <button type="button" onClick={zoomOut} title="Zoom out" aria-label="Zoom out">
          −
        </button>
        <button
          type="button"
          className="zoom-level"
          onClick={zoomReset}
          title="Reset to 100%"
          aria-label="Reset zoom to 100%"
        >
          {Math.round(viewport.scale * 100)}%
        </button>
        <button
          type="button"
          onClick={fitToView}
          title="Fit all to view"
          aria-label="Fit all to view"
        >
          Fit
        </button>
        <button
          type="button"
          onClick={zoomToSelection}
          title="Zoom to selection"
          aria-label="Zoom to selection"
        >
          ⤢
        </button>
      </div>
      <div className="minimap" title="Click or drag to navigate">
        <canvas
          ref={minimapRef}
          aria-hidden="true"
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            minimapDragRef.current = true;
            minimapNavigate(e.clientX, e.clientY);
          }}
        />
      </div>
    </>
  );
};
