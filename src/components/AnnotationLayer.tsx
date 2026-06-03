"use client";
import React from "react";
import { useFlow, useFlowCanvas } from "../hooks/useFlow";
import type { Annotation } from "../aws/annotations";

/**
 * Presentation-only annotation overlay (notes / callouts / zones).
 *
 * Annotations are NOT infrastructure — they're free-form labels, regions and
 * pointers an author draws over the diagram. They live on the graph at
 * `graph.annotations` and persist through save / share / version like the rest
 * of the model.
 *
 * Rendering mirrors {@link AccessibleNodes}: each annotation is an absolutely
 * positioned DOM element transformed with the SAME world→screen mapping the
 * imperative renderer uses (`left = viewport.x + worldX * scale`). Zones sit on
 * a layer BEHIND the nodes (a translucent backdrop); notes and callouts sit on
 * a layer ABOVE them. Dragging moves an annotation (live, uncommitted) and
 * commits one history entry on release; zones are corner-resizable like nodes.
 */

/** Default on-screen size (world units) for a note with no explicit w/h. */
const NOTE_W = 180;
const NOTE_H = 96;
/** Default callout bubble size (world units). */
const CALLOUT_W = 160;
const CALLOUT_H = 64;
/** Default zone region size (world units) — matches useFlow.addAnnotationOfKind. */
const ZONE_W = 360;
const ZONE_H = 240;
/** Smallest a zone may be resized to (world units), matching node resize feel. */
const MIN_ZONE_W = 80;
const MIN_ZONE_H = 60;
/** Click-vs-drag threshold in SCREEN pixels (zoom-independent), matching nodes. */
const DRAG_THRESHOLD_PX = 3;

/** Per-kind world-unit default width for an annotation with no explicit w. */
function defaultW(kind: Annotation["kind"]): number {
  return kind === "zone" ? ZONE_W : kind === "callout" ? CALLOUT_W : NOTE_W;
}
/** Per-kind world-unit default height for an annotation with no explicit h. */
function defaultH(kind: Annotation["kind"]): number {
  return kind === "zone" ? ZONE_H : kind === "callout" ? CALLOUT_H : NOTE_H;
}

type DragKind = "move" | "resize";
interface DragState {
  id: string;
  kind: DragKind;
  startClientX: number;
  startClientY: number;
  startX: number;
  startY: number;
  startW: number;
  startH: number;
  moved: boolean;
}

export const AnnotationLayer: React.FC = () => {
  const {
    annotations,
    selection,
    presentation,
    a11yNodes,
    selectAnnotation,
    updateAnnotationLive,
    updateAnnotation,
    commitAnnotationDrag,
  } = useFlow();
  const { viewport } = useFlowCanvas();
  const dragRef = React.useRef<DragState | null>(null);
  // Live viewport accessor for the window drag handlers. The handlers install
  // ONCE (stable identity), so they must read the current scale from this ref —
  // listing viewport.scale in the effect deps would tear down/re-add the
  // listeners on every zoom and could drop a mouseup that lands mid-swap,
  // stranding the drag (annotation "sticks" to the cursor). Mirrors Canvas.tsx.
  const viewportRef = React.useRef(viewport);
  viewportRef.current = viewport;
  // The annotation whose text is being edited inline (double-click to enter).
  const [editingId, setEditingId] = React.useState<string | null>(null);

  // World-space centre of every visible node, for callout leader lines.
  const nodeCenters = React.useMemo(() => {
    const m = new Map<string, { x: number; y: number }>();
    for (const n of a11yNodes) m.set(n.id, { x: n.x + n.w / 2, y: n.y + n.h / 2 });
    return m;
  }, [a11yNodes]);

  const selectedId = selection?.type === "annotation" ? selection.id : null;

  // Window-level drag handlers (install once; read the live drag via the ref so
  // listener identity stays stable, mirroring Canvas's move/up indirection).
  React.useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const scale = viewportRef.current.scale;
      // Click-vs-drag decision is SCREEN-pixel based (zoom-independent) so a
      // plain click never trips `moved` → no commit, no undo entry, no dirty.
      const dxScreen = e.clientX - d.startClientX;
      const dyScreen = e.clientY - d.startClientY;
      d.moved =
        d.moved || Math.abs(dxScreen) > DRAG_THRESHOLD_PX || Math.abs(dyScreen) > DRAG_THRESHOLD_PX;
      // Position/size updates stay in WORLD units (screenΔ / scale).
      const dxWorld = dxScreen / scale;
      const dyWorld = dyScreen / scale;
      if (d.kind === "move") {
        updateAnnotationLive(d.id, {
          x: Math.round(d.startX + dxWorld),
          y: Math.round(d.startY + dyWorld),
        });
      } else {
        updateAnnotationLive(d.id, {
          w: Math.max(MIN_ZONE_W, Math.round(d.startW + dxWorld)),
          h: Math.max(MIN_ZONE_H, Math.round(d.startH + dyWorld)),
        });
      }
    };
    const onUp = () => {
      const d = dragRef.current;
      if (!d) return;
      dragRef.current = null;
      // Only record a history entry if the annotation actually moved/resized.
      if (d.moved) commitAnnotationDrag();
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [updateAnnotationLive, commitAnnotationDrag]);

  // Split once per annotations change (not per pan/zoom/drag frame) so a live
  // interaction doesn't re-filter + re-allocate the whole list every render.
  // (Declared before any early return to keep hook order stable.)
  const zones = React.useMemo(() => annotations.filter((a) => a.kind === "zone"), [annotations]);
  const overlays = React.useMemo(() => annotations.filter((a) => a.kind !== "zone"), [annotations]);

  if (annotations.length === 0) return null;

  const beginDrag = (e: React.MouseEvent, a: Annotation, kind: DragKind) => {
    if (presentation) {
      selectAnnotation(a.id); // read-only: select for inspection, never drag
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    selectAnnotation(a.id);
    dragRef.current = {
      id: a.id,
      kind,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startX: a.x,
      startY: a.y,
      startW: a.w ?? defaultW(a.kind),
      startH: a.h ?? defaultH(a.kind),
      moved: false,
    };
  };

  // Screen-space helpers (world → screen for absolute positioning).
  const sx = (worldX: number) => viewport.x + worldX * viewport.scale;
  const sy = (worldY: number) => viewport.y + worldY * viewport.scale;

  return (
    <>
      {/* Zone layer — translucent labelled regions BEHIND the nodes. */}
      <div className="annz" aria-hidden="true">
        {zones.map((a) => {
          const selected = a.id === selectedId;
          const w = (a.w ?? ZONE_W) * viewport.scale;
          const h = (a.h ?? ZONE_H) * viewport.scale;
          const editing = editingId === a.id;
          return (
            <div
              key={a.id}
              className={`ann-zone${selected ? " selected" : ""}`}
              style={{
                left: sx(a.x),
                top: sy(a.y),
                width: w,
                height: h,
                ...(a.color ? { ["--ann-color" as string]: a.color } : {}),
              }}
              onMouseDown={(e) => {
                if (editing) return;
                beginDrag(e, a, "move");
              }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                if (!presentation) setEditingId(a.id);
              }}
            >
              {editing ? (
                <textarea
                  className="ann-edit ann-zone-edit"
                  autoFocus
                  defaultValue={a.text}
                  onMouseDown={(e) => e.stopPropagation()}
                  onBlur={(e) => {
                    updateAnnotation(a.id, { text: e.target.value });
                    setEditingId(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      e.preventDefault();
                      setEditingId(null);
                    }
                    // Cmd/Ctrl+Enter commits (plain Enter inserts a newline).
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      e.currentTarget.blur();
                    }
                  }}
                />
              ) : (
                <span className="ann-zone-label">{a.text}</span>
              )}
              {selected && !presentation && !editing && (
                <span
                  className="ann-resize"
                  title="Drag to resize"
                  onMouseDown={(e) => beginDrag(e, a, "resize")}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Callout leader lines — drawn in an SVG transformed like the edges. */}
      <svg
        className="ann-leaders"
        aria-hidden="true"
        style={{
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`,
        }}
      >
        {overlays.map((a) => {
          if (a.kind !== "callout" || !a.targetId) return null;
          const target = nodeCenters.get(a.targetId);
          if (!target) return null;
          const w = a.w ?? CALLOUT_W;
          const h = a.h ?? CALLOUT_H;
          const from = { x: a.x + w / 2, y: a.y + h / 2 };
          return (
            <line
              key={a.id}
              className="ann-leader"
              x1={from.x}
              y1={from.y}
              x2={target.x}
              y2={target.y}
              stroke={a.color ?? "#9fb3c8"}
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
      </svg>

      {/* Note / callout layer — ABOVE the nodes. */}
      <div className="anno">
        {overlays.map((a) => {
          const selected = a.id === selectedId;
          const w = (a.w ?? (a.kind === "callout" ? CALLOUT_W : NOTE_W)) * viewport.scale;
          const h = (a.h ?? (a.kind === "callout" ? CALLOUT_H : NOTE_H)) * viewport.scale;
          const editing = editingId === a.id;
          return (
            <div
              key={a.id}
              className={`ann-${a.kind}${selected ? " selected" : ""}`}
              style={{
                left: sx(a.x),
                top: sy(a.y),
                width: w,
                minHeight: h,
                ...(a.color ? { ["--ann-color" as string]: a.color } : {}),
              }}
              role="group"
              aria-label={`${a.kind}: ${a.text}`}
              onMouseDown={(e) => {
                if (editing) return;
                beginDrag(e, a, "move");
              }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                if (!presentation) setEditingId(a.id);
              }}
            >
              {editing ? (
                <textarea
                  className="ann-edit"
                  autoFocus
                  defaultValue={a.text}
                  onMouseDown={(e) => e.stopPropagation()}
                  onBlur={(e) => {
                    updateAnnotation(a.id, { text: e.target.value });
                    setEditingId(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      e.preventDefault();
                      setEditingId(null);
                    }
                    // Cmd/Ctrl+Enter commits (plain Enter inserts a newline).
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      e.currentTarget.blur();
                    }
                  }}
                />
              ) : (
                <span className="ann-text">{a.text}</span>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
};
