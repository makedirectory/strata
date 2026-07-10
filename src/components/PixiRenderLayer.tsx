"use client";
import React, { useEffect, useRef, useState } from "react";
import type { Application, Container as PixiContainer, Graphics, Sprite, Texture } from "pixi.js";
import { useFlow, useFlowCanvas } from "../hooks/useFlow";
import { serviceColor, serviceIcon } from "../aws/registry";
import { lodTier, screenToWorld, nodesInRect } from "../canvas/geometry";
import { rectCenter, edgeAnchor } from "../canvas/drawPrimitives";
import { hitTest, type HitNode } from "../canvas/hitTest";
import { useRenderMode } from "../canvas/renderMode";
import type { A11yNode } from "../hooks/useFlow";
import type { Viewport } from "../aws/model";

/**
 * Mode A — WebGL renderer via PixiJS (renderer-scale spec, the "kick it up a
 * level" path). Gated behind `NEXT_PUBLIC_STRATA_CANVAS_RENDERER=webgl` (or
 * `pixi`) or the 2D⚡ view toggle. It owns its own interaction: click-select,
 * hover, pan (zoom via the shared wheel listener), drag-to-move with live subtree
 * follow, drag-to-reparent (containerAt), shift-drag marquee, connect-mode drag,
 * and double-click container focus. Node chrome = provider / child-count badge +
 * config pills. Remaining vs the DOM view: leaf summarization (the WebGL layer
 * renders every node instead).
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
  const { a11yNodes, selectedIds, state, selectNode, onNodeDoubleClick } = useFlow();
  const { viewport, setViewport, moveResource, setSelectedIds, connect, setParent, containerAt } =
    useFlowCanvas();
  const enabled = useRenderMode() === "webgl";
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
  // Config pills toggle at the NEAR tier only (labels show at near + mid).
  const pillsRef = useRef<PixiContainer[]>([]);
  const lastTierRef = useRef<string>("");
  // Emoji → shared Texture cache, so N nodes with the same icon batch into one
  // draw (rasterise each unique glyph once, reuse across the whole scene).
  const iconTexRef = useRef<Map<string, Texture>>(new Map());
  // id → node Container, so a live drag can move one node without a full rebuild.
  const nodesByIdRef = useRef<Map<string, PixiContainer>>(new Map());
  const [ready, setReady] = useState(false);

  // Always-current inputs for the (once-installed) pointer handlers.
  const a11yNodesRef = useRef<A11yNode[]>(a11yNodes);
  a11yNodesRef.current = a11yNodes;
  const selectNodeRef = useRef(selectNode);
  selectNodeRef.current = selectNode;
  const setViewportRef = useRef(setViewport);
  setViewportRef.current = setViewport;
  const moveResourceRef = useRef(moveResource);
  moveResourceRef.current = moveResource;
  const modeRef = useRef(state.mode);
  modeRef.current = state.mode;
  const onDoubleClickRef = useRef(onNodeDoubleClick);
  onDoubleClickRef.current = onNodeDoubleClick;
  const setSelectedIdsRef = useRef(setSelectedIds);
  setSelectedIdsRef.current = setSelectedIds;
  const connectRef = useRef(connect);
  connectRef.current = connect;
  const setParentRef = useRef(setParent);
  setParentRef.current = setParent;
  const containerAtRef = useRef(containerAt);
  containerAtRef.current = containerAt;

  // Always-current transient state, read by the rebuild without becoming a dep —
  // so a rebuild only ever fires on a STRUCTURAL change (nodes/edges), never on
  // pan, zoom, or selection (those have their own cheap, targeted effects).
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  const selectedRef = useRef(selectedIds);
  selectedRef.current = selectedIds;

  // ---- init once (client-only; Pixi dynamically imported) ----
  useEffect(() => {
    if (!enabled) return;
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
    // Re-run on toggle: mount the WebGL app when 2D-fast is chosen, tear down on leave.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  // ---- rebuild the retained scene graph when nodes/edges change ----
  useEffect(() => {
    if (!enabled || !ready) return;
    const PIXI = pixiRef.current;
    const nodeLayer = nodeLayerRef.current;
    const edgeLayer = edgeLayerRef.current;
    if (!PIXI || !nodeLayer || !edgeLayer) return;

    for (const c of nodeLayer.removeChildren()) c.destroy({ children: true });
    for (const c of edgeLayer.removeChildren()) c.destroy({ children: true });
    ringsRef.current.clear();
    labelsRef.current = [];
    pillsRef.current = [];
    nodesByIdRef.current.clear();

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

      // Top-right badge: container child-count, else provider (AWS/GCP/Azure).
      const badgeText = n.isContainer ? String(n.childCount) : n.provider.toUpperCase();
      if (badgeText) {
        const badge = new PIXI.BitmapText({
          text: badgeText,
          style: { fontFamily: LABEL_FONT, fontSize: 10 },
        });
        badge.tint = 0x8ba0c8;
        badge.position.set(n.w - 10 - badge.width, 10); // right-aligned
        badge.visible = labelsVisible;
        labelsRef.current.push(badge);
        node.addChild(badge);
      }

      // Config pills (leaves, near tier only) — one muted line along the bottom.
      if (!n.isContainer && n.pills.length > 0) {
        const pills = new PIXI.BitmapText({
          text: n.pills.join("   ·   "),
          style: { fontFamily: LABEL_FONT, fontSize: 10 },
        });
        pills.tint = 0x7c8aa5;
        pills.position.set(16, n.h - 16);
        pills.visible = tierNow === "near";
        pillsRef.current.push(pills);
        node.addChild(pills);
      }

      const ring = new PIXI.Graphics();
      ring.roundRect(-2, -2, n.w + 4, n.h + 4, 14).stroke({ width: 2, color: SELECT_RING });
      ring.visible = selected.has(n.id);
      ringsRef.current.set(n.id, ring);
      node.addChild(ring);

      nodeLayer.addChild(node);
      nodesByIdRef.current.set(n.id, node);
    }
    lastTierRef.current = tierNow;
  }, [enabled, ready, a11yNodes, state.relationships]);

  // ---- selection: toggle rings only (no rebuild) ----
  useEffect(() => {
    if (!enabled || !ready) return;
    const selected = new Set(selectedIds);
    for (const [id, ring] of ringsRef.current) ring.visible = selected.has(id);
  }, [enabled, ready, selectedIds]);

  // ---- interaction (Stage 2 + 4): the WebGL layer OWNS pointer input ----
  // select/hover, empty-space pan (zoom rides the canvas-wrap wheel listener),
  // drag-to-move with live subtree follow + drag-to-reparent, shift-drag marquee,
  // connect-mode drag to create a relationship, and double-click container focus.
  useEffect(() => {
    if (!enabled || !ready) return;
    const host = hostRef.current;
    const PIXI = pixiRef.current;
    if (!host) return;

    const nodes = () => a11yNodesRef.current;
    const hitNodes = (): HitNode[] =>
      nodes().map((n) => ({ id: n.id, rect: { x: n.x, y: n.y, w: n.w, h: n.h }, depth: n.depth }));
    const nodeById = (id: string) => nodes().find((n) => n.id === id);
    const toWorld = (e: PointerEvent) => {
      const rect = host.getBoundingClientRect();
      return screenToWorld(
        { x: e.clientX - rect.left, y: e.clientY - rect.top },
        viewportRef.current,
      );
    };
    // id + all descendants (so dragging a container moves its whole subtree).
    const subtree = (id: string): Set<string> => {
      const set = new Set<string>([id]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const n of nodes()) {
          if (n.parentId && set.has(n.parentId) && !set.has(n.id)) {
            set.add(n.id);
            grew = true;
          }
        }
      }
      return set;
    };

    // Transient overlay (marquee rect / connect line) in world coords.
    let overlay: Graphics | null = null;
    const ensureOverlay = (): Graphics | null => {
      if (!overlay && PIXI && worldRef.current) {
        overlay = new PIXI.Graphics();
        worldRef.current.addChild(overlay);
      }
      return overlay;
    };

    let mode: "none" | "pan" | "drag" | "marquee" | "connect" = "none";
    let dragRoot: string | null = null;
    let dragStart: { id: string; sx: number; sy: number }[] = [];
    let grabDX = 0;
    let grabDY = 0;
    let panVp: Viewport = viewportRef.current;
    let panSX = 0;
    let panSY = 0;
    let mqStart = { x: 0, y: 0 };
    let connectFrom: string | null = null;
    let last = { x: 0, y: 0 };
    let moved = false;

    const onDown = (e: PointerEvent) => {
      host.setPointerCapture(e.pointerId);
      moved = false;
      const w = toWorld(e);
      const id = hitTest(hitNodes(), w.x, w.y);
      if (id) {
        selectNodeRef.current(id);
        if (modeRef.current === "connect") {
          mode = "connect";
          connectFrom = id;
        } else {
          mode = "drag";
          dragRoot = id;
          const n = nodeById(id)!;
          grabDX = w.x - n.x;
          grabDY = w.y - n.y;
          const sub = subtree(id);
          dragStart = nodes()
            .filter((n2) => sub.has(n2.id))
            .map((n2) => ({ id: n2.id, sx: n2.x, sy: n2.y }));
        }
      } else if (e.shiftKey) {
        mode = "marquee";
        mqStart = w;
      } else {
        mode = "pan";
        panVp = { ...viewportRef.current };
        const rect = host.getBoundingClientRect();
        panSX = e.clientX - rect.left;
        panSY = e.clientY - rect.top;
      }
    };
    const onMove = (e: PointerEvent) => {
      const rect = host.getBoundingClientRect();
      const w = toWorld(e);
      last = w;
      if (mode === "pan") {
        moved = true;
        setViewportRef.current({
          x: panVp.x + (e.clientX - rect.left - panSX),
          y: panVp.y + (e.clientY - rect.top - panSY),
          scale: panVp.scale,
        });
      } else if (mode === "drag" && dragRoot) {
        moved = true;
        const root = nodeById(dragRoot);
        if (!root) return;
        const dx = w.x - grabDX - root.x;
        const dy = w.y - grabDY - root.y;
        for (const d of dragStart)
          nodesByIdRef.current.get(d.id)?.position.set(d.sx + dx, d.sy + dy);
      } else if (mode === "marquee") {
        const g = ensureOverlay();
        g?.clear()
          .rect(
            Math.min(mqStart.x, w.x),
            Math.min(mqStart.y, w.y),
            Math.abs(w.x - mqStart.x),
            Math.abs(w.y - mqStart.y),
          )
          .fill({ color: SELECT_RING, alpha: 0.08 })
          .stroke({ width: 1, color: SELECT_RING });
      } else if (mode === "connect" && connectFrom) {
        const from = nodeById(connectFrom);
        const g = ensureOverlay();
        if (from && g)
          g.clear()
            .moveTo(from.x + from.w / 2, from.y + from.h / 2)
            .lineTo(w.x, w.y)
            .stroke({ width: 2, color: SELECT_RING });
      } else {
        host.style.cursor = hitTest(hitNodes(), w.x, w.y) ? "pointer" : "grab";
      }
    };
    const onUp = () => {
      if (mode === "drag" && dragRoot && moved) {
        const root = nodeById(dragRoot);
        const dropX = last.x - grabDX; // new top-left of the dragged node
        const dropY = last.y - grabDY;
        // Reparent when dropped into a different container; else move (roots only —
        // a child's position is engine-owned, so it snaps back on rebuild).
        const target = containerAtRef.current(last, dragRoot);
        const cur = root?.parentId ?? null;
        if (target !== cur)
          setParentRef.current(dragRoot, target ?? undefined, { x: dropX, y: dropY });
        else moveResourceRef.current(dragRoot, dropX, dropY);
      } else if (mode === "marquee") {
        const rect = {
          x: Math.min(mqStart.x, last.x),
          y: Math.min(mqStart.y, last.y),
          w: Math.abs(last.x - mqStart.x),
          h: Math.abs(last.y - mqStart.y),
        };
        setSelectedIdsRef.current(nodesInRect(nodes(), rect));
      } else if (mode === "connect" && connectFrom) {
        const target = hitTest(hitNodes(), last.x, last.y);
        if (target && target !== connectFrom) connectRef.current(connectFrom, target);
      }
      overlay?.clear();
      mode = "none";
      dragRoot = null;
      dragStart = [];
      connectFrom = null;
    };
    const onDbl = (e: MouseEvent) => {
      const rect = host.getBoundingClientRect();
      const w = screenToWorld(
        { x: e.clientX - rect.left, y: e.clientY - rect.top },
        viewportRef.current,
      );
      const id = hitTest(hitNodes(), w.x, w.y);
      if (id) onDoubleClickRef.current(id);
    };

    host.addEventListener("pointerdown", onDown);
    host.addEventListener("pointermove", onMove);
    host.addEventListener("pointerup", onUp);
    host.addEventListener("pointercancel", onUp);
    host.addEventListener("dblclick", onDbl);
    return () => {
      host.removeEventListener("pointerdown", onDown);
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerup", onUp);
      host.removeEventListener("pointercancel", onUp);
      host.removeEventListener("dblclick", onDbl);
      overlay?.destroy();
    };
  }, [enabled, ready]);

  // ---- camera: move the world, not the nodes (O(1) pan/zoom) ----
  useEffect(() => {
    if (!enabled || !ready) return;
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
      // Pills are detail — only at the near tier.
      for (const pill of pillsRef.current) pill.visible = tierNow === "near";
      lastTierRef.current = tierNow;
    }
  }, [enabled, ready, viewport]);

  if (!enabled) return null;
  return (
    <div
      ref={hostRef}
      className="pixi-render-layer"
      aria-hidden="true"
      style={{ position: "absolute", inset: 0, pointerEvents: "auto", cursor: "grab" }}
    />
  );
};
