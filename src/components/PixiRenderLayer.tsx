"use client";
import React, { useEffect, useRef, useState } from "react";
import type { Application, Container as PixiContainer, Graphics, Sprite, Texture } from "pixi.js";
import { useFlow, useFlowCanvas } from "../hooks/useFlow";
import { serviceColor, serviceIcon } from "../aws/registry";
import { lodTier } from "../canvas/geometry";
import { rectCenter, edgeAnchor } from "../canvas/drawPrimitives";

/**
 * Mode A — WebGL renderer via PixiJS (renderer-scale spec, the "kick it up a
 * level" path). Gated behind `NEXT_PUBLIC_STRATA_CANVAS_RENDERER=webgl` (or
 * `pixi`); off by default → zero regression. Read-only over the DOM path, which
 * still owns all interaction.
 *
 * The performance model is a game engine's: build the node/edge display objects
 * ONCE into a retained scene graph, then **move the camera, not the objects**.
 * Pan/zoom just sets the world `Container`'s position/scale — O(1) regardless of
 * node count — instead of repainting every node per frame (the Canvas-2D layer's
 * ceiling). PixiJS batches the cards/edges on the GPU; text is rasterised once
 * per node and thereafter drawn as a textured quad.
 *
 * Same pure inputs as every other painter: `a11yNodes` (culled visible set with
 * world rects + depth) + `viewport`; colour/icon from the registry; edge
 * geometry from the shared `drawPrimitives`. Pixi is loaded via dynamic import
 * so it stays out of the main bundle (and off the SSR path) unless enabled.
 */
const MODE = process.env.NEXT_PUBLIC_STRATA_CANVAS_RENDERER;
const ENABLED = MODE === "webgl" || MODE === "pixi";

const EDGE_COLOR = "#3a4a6b";
const LEAF_FILL = "#0f1a31";
const LEAF_STROKE = "#24406b";
const LABEL_FILL = "#e6edf7";
const SELECT_RING = "#38bdf8";

/** Installed bitmap-font name for node labels (batched — scales to thousands). */
const LABEL_FONT = "strata-label";
/** Bitmap fonts install globally; guard against re-installing on remount. */
let bitmapFontInstalled = false;

export const PixiRenderLayer: React.FC = () => {
  const { a11yNodes, selectedIds, state } = useFlow();
  const { viewport } = useFlowCanvas();
  const hostRef = useRef<HTMLDivElement>(null);

  // Pixi runtime handles (kept in refs; typed via type-only imports).
  const pixiRef = useRef<typeof import("pixi.js") | null>(null);
  const appRef = useRef<Application | null>(null);
  const worldRef = useRef<PixiContainer | null>(null);
  const edgeLayerRef = useRef<PixiContainer | null>(null);
  const nodeLayerRef = useRef<PixiContainer | null>(null);
  // Per-node handles for cheap, targeted updates without a full rebuild.
  const ringsRef = useRef<Map<string, Graphics>>(new Map());
  const labelsRef = useRef<PixiContainer[]>([]);
  const lastTierRef = useRef<string>("");
  // Emoji → shared Texture cache, so N nodes with the same icon batch into one
  // draw (rasterise each unique glyph once, reuse across the whole scene).
  const iconTexRef = useRef<Map<string, Texture>>(new Map());
  const [ready, setReady] = useState(false);

  // Always-current transient state, read by the rebuild without becoming a dep —
  // so a rebuild only ever fires on a STRUCTURAL change (nodes/edges), never on
  // pan, zoom, or selection (those have their own cheap, targeted effects).
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  const selectedRef = useRef(selectedIds);
  selectedRef.current = selectedIds;

  // ---- init once (client-only; Pixi dynamically imported) ----
  useEffect(() => {
    if (!ENABLED) return;
    let disposed = false;
    // Capture the stable ref maps for the cleanup closure (they're created once).
    const rings = ringsRef.current;
    const iconTex = iconTexRef.current;
    void (async () => {
      const PIXI = await import("pixi.js");
      const host = hostRef.current;
      if (disposed || !host) return;
      // Install a batched bitmap font for labels once (a glyph atlas, so text is
      // drawn as textured quads instead of one texture per node — the key to
      // scaling labels to thousands of nodes).
      if (!bitmapFontInstalled) {
        PIXI.BitmapFont.install({
          name: LABEL_FONT,
          style: {
            fontFamily: "ui-sans-serif, system-ui, sans-serif",
            fontSize: 28,
            fill: LABEL_FILL,
            fontWeight: "600",
          },
        });
        bitmapFontInstalled = true;
      }
      const app = new PIXI.Application();
      await app.init({
        resizeTo: host,
        backgroundAlpha: 0,
        antialias: true,
        autoDensity: true,
        resolution: typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1,
      });
      if (disposed) {
        app.destroy(true, { children: true });
        return;
      }
      host.appendChild(app.canvas);
      const world = new PIXI.Container();
      const edgeLayer = new PIXI.Container();
      const nodeLayer = new PIXI.Container();
      world.addChild(edgeLayer, nodeLayer);
      app.stage.addChild(world);
      pixiRef.current = PIXI;
      appRef.current = app;
      worldRef.current = world;
      edgeLayerRef.current = edgeLayer;
      nodeLayerRef.current = nodeLayer;
      setReady(true);
    })();
    return () => {
      disposed = true;
      const app = appRef.current;
      if (app) app.destroy(true, { children: true });
      appRef.current = null;
      worldRef.current = null;
      pixiRef.current = null;
      rings.clear();
      labelsRef.current = [];
      for (const t of iconTex.values()) t.destroy(true);
      iconTex.clear();
      setReady(false);
    };
  }, []);

  // ---- rebuild the retained scene graph when nodes/edges change ----
  useEffect(() => {
    if (!ENABLED || !ready) return;
    const PIXI = pixiRef.current;
    const nodeLayer = nodeLayerRef.current;
    const edgeLayer = edgeLayerRef.current;
    if (!PIXI || !nodeLayer || !edgeLayer) return;

    for (const c of nodeLayer.removeChildren()) c.destroy({ children: true });
    for (const c of edgeLayer.removeChildren()) c.destroy({ children: true });
    ringsRef.current.clear();
    labelsRef.current = [];

    // Edges: one Graphics for all wires, clipped to node borders (shared geom).
    const rectById = new Map(a11yNodes.map((n) => [n.id, n]));
    const edges = new PIXI.Graphics();
    for (const rel of state.relationships) {
      if (rel.from === rel.to) continue;
      const a = rectById.get(rel.from);
      const b = rectById.get(rel.to);
      if (!a || !b) continue;
      const ra = { x: a.x, y: a.y, w: a.w, h: a.h };
      const rb = { x: b.x, y: b.y, w: b.w, h: b.h };
      const p1 = edgeAnchor(ra, rectCenter(rb));
      const p2 = edgeAnchor(rb, rectCenter(ra));
      edges.moveTo(p1.x, p1.y).lineTo(p2.x, p2.y);
    }
    edges.stroke({ width: 1.5, color: EDGE_COLOR });
    edgeLayer.addChild(edges);

    // Rasterise an emoji into a shared Texture the first time it's seen.
    const iconTexture = (emoji: string): Texture => {
      const cache = iconTexRef.current;
      const hit = cache.get(emoji);
      if (hit) return hit;
      const c = document.createElement("canvas");
      const size = 48;
      c.width = size;
      c.height = size;
      const cx = c.getContext("2d");
      if (cx) {
        cx.font = `${Math.round(size * 0.8)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
        cx.textAlign = "center";
        cx.textBaseline = "middle";
        cx.fillText(emoji, size / 2, size / 2);
      }
      const tex = PIXI.Texture.from(c);
      cache.set(emoji, tex);
      return tex;
    };

    // Nodes: one Container each (card + accent + label + hidden selection ring).
    const selected = new Set(selectedRef.current);
    const tierNow = lodTier(viewportRef.current.scale);
    const labelsVisible = tierNow !== "far";
    // Paint order = z-order: containers first (shallow→deep) so their translucent
    // backplates sit BENEATH the leaves nested in them, then leaves on top.
    const ordered = [...a11yNodes].sort((a, b) => {
      const ac = a.isContainer ? 0 : 1;
      const bc = b.isContainer ? 0 : 1;
      return ac !== bc ? ac - bc : a.depth - b.depth;
    });
    for (const n of ordered) {
      const node = new PIXI.Container();
      node.position.set(n.x, n.y);
      const color = serviceColor(n.serviceId);
      const card = new PIXI.Graphics();
      if (n.isContainer) {
        card.roundRect(0, 0, n.w, n.h, 12).fill({ color, alpha: 0.08 });
        card.stroke({ width: 1.5, color });
      } else {
        card.roundRect(0, 0, n.w, n.h, 14).fill(LEAF_FILL).stroke({ width: 1, color: LEAF_STROKE });
        card.roundRect(0, 0, 4, n.h, 2).fill(color); // accent bar
      }
      node.addChild(card);

      // Label group: batched icon Sprite (shared texture) + bitmap-font name.
      const label = new PIXI.Container();
      const iconSprite = new PIXI.Sprite(iconTexture(serviceIcon(n.serviceId)));
      iconSprite.width = 16;
      iconSprite.height = 16;
      iconSprite.position.set(0, -1);
      const name = new PIXI.BitmapText({
        text: n.name,
        style: { fontFamily: LABEL_FONT, fontSize: 14 },
      });
      name.position.set(20, 1);
      label.addChild(iconSprite, name);
      label.position.set(n.isContainer ? 14 : 16, n.isContainer ? 10 : n.h / 2 - 9);
      label.visible = labelsVisible;
      labelsRef.current.push(label);
      node.addChild(label);

      const ring = new PIXI.Graphics();
      ring.roundRect(-2, -2, n.w + 4, n.h + 4, 14).stroke({ width: 2, color: SELECT_RING });
      ring.visible = selected.has(n.id);
      ringsRef.current.set(n.id, ring);
      node.addChild(ring);

      nodeLayer.addChild(node);
    }
    lastTierRef.current = tierNow;
  }, [ready, a11yNodes, state.relationships]);

  // ---- selection: toggle rings only (no rebuild) ----
  useEffect(() => {
    if (!ENABLED || !ready) return;
    const selected = new Set(selectedIds);
    for (const [id, ring] of ringsRef.current) ring.visible = selected.has(id);
  }, [ready, selectedIds]);

  // ---- camera: move the world, not the nodes (O(1) pan/zoom) ----
  useEffect(() => {
    if (!ENABLED || !ready) return;
    const world = worldRef.current;
    if (!world) return;
    world.position.set(viewport.x, viewport.y);
    world.scale.set(viewport.scale);
    // LOD labels: only touch them when the tier actually changes, so panning
    // within a zoom band stays free.
    const tierNow = lodTier(viewport.scale);
    if (tierNow !== lastTierRef.current) {
      const show = tierNow !== "far";
      for (const label of labelsRef.current) label.visible = show;
      lastTierRef.current = tierNow;
    }
  }, [ready, viewport]);

  if (!ENABLED) return null;
  return (
    <div
      ref={hostRef}
      className="pixi-render-layer"
      aria-hidden="true"
      style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
    />
  );
};
