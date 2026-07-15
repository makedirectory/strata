"use client";
import React, { useCallback, useEffect, useRef } from "react";
import { useFlow, useFlowCanvas } from "../hooks/useFlow";
import { serviceColor, serviceIcon } from "../aws/registry";
import { dprBackingSize, viewportWorldRect } from "../canvas/geometry";
import { buildCanvasScene, paintScene, type SceneNode } from "../canvas/canvasScene";

/**
 * Mode A (renderer-scale spec), Stage 1: an imperative `<canvas>` 2D draw layer
 * that paints the culled visible node/edge set, layered over the existing DOM
 * render. It is **read-only** — the DOM path still handles all interaction — and
 * gated behind `NEXT_PUBLIC_STRATA_CANVAS_RENDERER=1`, so it's off by default and
 * cannot regress current behaviour. It exists to validate the canvas painter and
 * measure frame time at scale before the later stages move interaction onto it.
 *
 * It consumes the same pure inputs as everything else: `a11yNodes` (the culled
 * visible set, with world rects + depth) and `viewport`. Colour/icon come from
 * the registry; drawing reuses the shared `drawPrimitives`, so what this paints
 * matches the SVG export.
 *
 * Flag: `NEXT_PUBLIC_STRATA_CANVAS_RENDERER=1|canvas`. The `webgl|pixi` value
 * instead selects the PixiJS layer (`PixiRenderLayer`).
 */
const MODE = process.env.NEXT_PUBLIC_STRATA_CANVAS_RENDERER;
const ENABLED = MODE === "1" || MODE === "canvas";

export const CanvasRenderLayer: React.FC = () => {
  const { a11yNodes, selectedIds, state } = useFlow();
  const { viewport } = useFlowCanvas();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 });

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { w, h, dpr } = sizeRef.current;
    if (w === 0 || h === 0) return;
    const selected = new Set(selectedIds);
    const nodes: SceneNode[] = a11yNodes.map((n) => ({
      id: n.id,
      rect: { x: n.x, y: n.y, w: n.w, h: n.h },
      depth: n.depth,
      isContainer: n.isContainer,
      color: serviceColor(n.serviceId),
      icon: serviceIcon(n.serviceId),
      label: n.name,
      selected: selected.has(n.id),
    }));
    const cull = viewportWorldRect(viewport, { width: w, height: h });
    const scene = buildCanvasScene(nodes, state.relationships, cull);
    paintScene(ctx, scene, viewport, { dpr, cssWidth: w, cssHeight: h });
  }, [a11yNodes, selectedIds, state.relationships, viewport]);

  // Keep the latest paint reachable from the (once-installed) ResizeObserver.
  const paintRef = useRef(paint);
  paintRef.current = paint;

  // Size the backing store to the parent × DPR, and repaint on resize.
  useEffect(() => {
    if (!ENABLED) return;
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    if (!canvas || !parent) return;
    const resize = () => {
      const rect = parent.getBoundingClientRect();
      const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
      const backing = dprBackingSize(rect.width, rect.height, dpr);
      canvas.width = backing.width;
      canvas.height = backing.height;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      sizeRef.current = { w: rect.width, h: rect.height, dpr: backing.ratio };
      paintRef.current();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(parent);
    resize();
    return () => ro.disconnect();
  }, []);

  // Repaint on any input change, coalesced to a single animation frame.
  useEffect(() => {
    if (!ENABLED) return;
    const id = requestAnimationFrame(() => paintRef.current());
    return () => cancelAnimationFrame(id);
  }, [paint]);

  if (!ENABLED) return null;
  return (
    <canvas
      ref={canvasRef}
      className="canvas-render-layer"
      aria-hidden="true"
      style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
    />
  );
};
