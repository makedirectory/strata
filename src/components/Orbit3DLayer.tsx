"use client";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useFlow } from "../hooks/useFlow";
import { serviceColor, serviceIcon } from "../aws/registry";
import { boundsOf } from "../canvas/geometry";
import {
  type OrbitCamera,
  type Vec3,
  buildCameraBasis,
  project,
  nodeGeom,
  boxCorners,
  BOX_FACES,
  bezier,
  pointInPoly,
  labelFontPx,
  shade,
  add,
  sub,
  scl,
  dot,
  norm,
} from "../canvas/orbit3d";
import { renderMode } from "../canvas/renderMode";

/**
 * Mode B — 3D orbit view. Containment depth becomes elevation, so a deeply
 * nested estate reads as stacked floor-plates you can orbit. Gated behind
 * `NEXT_PUBLIC_STRATA_CANVAS_RENDERER=3d`; the DOM structural render stands down
 * when it's active (see renderMode), and this canvas is opaque + owns pointer
 * input, so there's no double-paint. Reprojects the same pure layout
 * (`a11yNodes`: world rect + depth) every other renderer uses; colour/icon come
 * from the registry; picking routes to the same selection store.
 */
const ENABLED = renderMode() === "3d";

const LAYER_GAP = 3.0;
const LIGHT = norm({ x: -0.4, y: 1, z: 0.35 });

/** Relationship-kind → wire colour (falls back to a neutral slate). */
const EDGE_COLOR: Record<string, string> = {
  routes_to: "#4fd1c5",
  depends_on: "#f59e0b",
  attached_to: "#a78bfa",
  connects_to: "#60a5fa",
  reads_from: "#34d399",
  writes_to: "#34d399",
  invokes: "#f472b6",
};

interface Node3D {
  id: string;
  name: string;
  color: string;
  icon: string;
  depth: number;
  rect: { x: number; y: number; w: number; h: number };
  container: boolean;
}

export const Orbit3DLayer: React.FC = () => {
  const { a11yNodes, selectedIds, state, selectNode } = useFlow();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [explode, setExplode] = useState(1.4);
  const [autoOrbit, setAutoOrbit] = useState(false);
  const [showLabels, setShowLabels] = useState(true);

  // ---- derive the 3D scene from the pure layout + registry ----
  const nodes = useMemo<Node3D[]>(
    () =>
      a11yNodes.map((n) => ({
        id: n.id,
        name: n.name,
        color: serviceColor(n.serviceId),
        icon: serviceIcon(n.serviceId),
        depth: n.depth,
        rect: { x: n.x, y: n.y, w: n.w, h: n.h },
        container: n.isContainer,
      })),
    [a11yNodes],
  );
  const edges = useMemo(() => {
    const ids = new Set(nodes.map((n) => n.id));
    return state.relationships
      .filter((e) => e.from !== e.to && ids.has(e.from) && ids.has(e.to))
      .map((e) => ({ from: e.from, to: e.to, color: EDGE_COLOR[e.kind] ?? "#5b6b8c" }));
  }, [nodes, state.relationships]);

  const layout = useMemo(() => {
    const bounds = boundsOf(nodes.map((n) => n.rect));
    const center = bounds
      ? { x: bounds.x + bounds.w / 2, z: bounds.y + bounds.h / 2 }
      : { x: 0, z: 0 };
    const span = bounds ? Math.max(bounds.w, bounds.h, 1) : 1;
    const worldScale = Math.max(0.008, Math.min(0.05, 48 / span));
    const maxDepth = nodes.reduce((m, n) => Math.max(m, n.depth), 0);
    return { center, worldScale, maxDepth };
  }, [nodes]);

  // ---- mutable render state (refs so the rAF loop reads the latest) ----
  const camRef = useRef<OrbitCamera>({
    target: { x: 0, y: 3, z: 0 },
    az: 0.72,
    el: 0.62,
    dist: 46,
    fov: (55 * Math.PI) / 180,
  });
  const sceneRef = useRef({
    nodes,
    edges,
    layout,
    explode,
    showLabels,
    selectedId: selectedIds[0] ?? null,
  });
  sceneRef.current = {
    nodes,
    edges,
    layout,
    explode,
    showLabels,
    selectedId: selectedIds[0] ?? null,
  };
  const sizeRef = useRef({ W: 0, H: 0, DPR: 1 });
  const topFacesRef = useRef<Map<string, [number, number][]>>(new Map());
  const hoverRef = useRef<string | null>(null);
  const dirtyRef = useRef(true);
  const rafRef = useRef<number | null>(null);
  const autoOrbitRef = useRef(autoOrbit);
  autoOrbitRef.current = autoOrbit;
  const selectNodeRef = useRef(selectNode);
  selectNodeRef.current = selectNode;

  const requestRender = () => {
    dirtyRef.current = true;
  };
  // Re-centre the camera vertically as depth/explode change, then repaint.
  useEffect(() => {
    camRef.current.target.y = (layout.maxDepth * LAYER_GAP * explode) / 2;
    requestRender();
  }, [nodes, edges, layout, explode, showLabels, selectedIds]);

  useEffect(() => {
    if (!ENABLED) return;
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    if (!canvas || !parent) return;
    const ctx2d = canvas.getContext("2d");
    if (!ctx2d) return;
    const ctx: CanvasRenderingContext2D = ctx2d; // non-null for the nested closures

    const resize = () => {
      const rect = parent.getBoundingClientRect();
      const DPR = Math.min(window.devicePixelRatio || 1, 2);
      sizeRef.current = { W: rect.width, H: rect.height, DPR };
      canvas.width = Math.round(rect.width * DPR);
      canvas.height = Math.round(rect.height * DPR);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      requestRender();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(parent);
    resize();

    // ---- pointer interaction: drag=orbit, shift/right-drag=pan, wheel=zoom ----
    let dragging = false;
    let panning = false;
    let moved = false;
    let lastX = 0;
    let lastY = 0;
    let downX = 0;
    let downY = 0;
    let basis = buildCameraBasis(camRef.current, sizeRef.current.W, sizeRef.current.H);

    const onDown = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      dragging = true;
      panning = e.button === 2 || e.shiftKey || e.button === 1;
      moved = false;
      lastX = downX = e.clientX;
      lastY = downY = e.clientY;
    };
    const onMove = (e: PointerEvent) => {
      const cam = camRef.current;
      if (dragging) {
        const dx = e.clientX - lastX;
        const dy = e.clientY - lastY;
        lastX = e.clientX;
        lastY = e.clientY;
        if (Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY) > 4) moved = true;
        if (panning) {
          const s = cam.dist * 0.0016;
          cam.target = add(cam.target, add(scl(basis.right, -dx * s), scl(basis.up, dy * s)));
        } else {
          cam.az -= dx * 0.006;
          cam.el = Math.min(1.45, Math.max(0.08, cam.el + dy * 0.006));
        }
        requestRender();
      } else {
        const rect = canvas.getBoundingClientRect();
        const id = pick(e.clientX - rect.left, e.clientY - rect.top);
        if (id !== hoverRef.current) {
          hoverRef.current = id;
          canvas.style.cursor = id ? "pointer" : "grab";
          requestRender();
        }
      }
    };
    const onUp = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      if (!moved) {
        const rect = canvas.getBoundingClientRect();
        const id = pick(e.clientX - rect.left, e.clientY - rect.top);
        if (id) selectNodeRef.current(id);
      }
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const cam = camRef.current;
      cam.dist = Math.min(140, Math.max(8, cam.dist * (1 + Math.sign(e.deltaY) * 0.08)));
      requestRender();
    };
    const onCtx = (e: Event) => e.preventDefault();

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("contextmenu", onCtx);

    // ---- picking: topmost node whose projected top face contains the cursor ----
    function pick(px: number, py: number): string | null {
      let best: string | null = null;
      let bestZ = Infinity;
      for (const [id, poly] of topFacesRef.current) {
        if (!pointInPoly(px, py, poly)) continue;
        const rec = sceneRef.current.nodes.find((n) => n.id === id);
        if (!rec) continue;
        // Prefer nearer + deeper (leaves sit above their containers).
        const g = geom(rec);
        const c: Vec3 = { x: g.x0 + g.w / 2, y: g.y + g.thick, z: g.z0 + g.d / 2 };
        const p = project(basis, c);
        const z = p ? p.z - rec.depth * 0.001 : Infinity;
        if (z < bestZ) {
          bestZ = z;
          best = id;
        }
      }
      return best;
    }

    function geom(rec: Node3D) {
      const { layout: L, explode: ex } = sceneRef.current;
      return nodeGeom(rec.rect, rec.depth, {
        worldScale: L.worldScale,
        center: L.center,
        layerGap: LAYER_GAP,
        explode: ex,
        container: rec.container,
      });
    }

    // ---- draw ----
    const draw = () => {
      const { W, H, DPR } = sizeRef.current;
      if (W === 0 || H === 0) return;
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      basis = buildCameraBasis(camRef.current, W, H);
      const { nodes: recs, edges: eds, selectedId } = sceneRef.current;

      // background gradient + subtle glow
      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, "#0b1226");
      bg.addColorStop(0.55, "#080d1a");
      bg.addColorStop(1, "#05070f");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);
      const rg = ctx.createRadialGradient(
        W / 2,
        H * 0.42,
        40,
        W / 2,
        H * 0.42,
        Math.max(W, H) * 0.7,
      );
      rg.addColorStop(0, "rgba(79,209,197,0.06)");
      rg.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, W, H);

      drawFloor();

      // collect + painter-sort solid faces
      const prims: {
        z: number;
        rec: Node3D;
        face: (typeof BOX_FACES)[number];
        p: { sx: number; sy: number }[];
        sel: boolean;
        hover: boolean;
      }[] = [];
      topFacesRef.current = new Map();
      const hoverId = hoverRef.current;
      for (const rec of recs) {
        const g = geom(rec);
        const corners = boxCorners(g);
        const proj = corners.map((c) => project(basis, c));
        const top = [4, 5, 6, 7].map((i) => proj[i]);
        if (top.every(Boolean))
          topFacesRef.current.set(
            rec.id,
            top.map((p) => [p!.sx, p!.sy] as [number, number]),
          );
        for (const f of BOX_FACES) {
          const p = f.idx.map((i) => proj[i]);
          if (!p.every(Boolean)) continue;
          if (rec.container && f.kind === "bottom") continue;
          const cc = f.idx.map((i) => corners[i]);
          const faceCenter = scl(add(add(cc[0], cc[1]), add(cc[2], cc[3])), 0.25);
          const viewDir = sub(basis.eye, faceCenter);
          if (dot(f.n, viewDir) <= 0) continue; // back-face cull
          const pp = p as { sx: number; sy: number; z: number }[];
          const zc = (pp[0].z + pp[1].z + pp[2].z + pp[3].z) * 0.25;
          prims.push({
            z: zc,
            rec,
            face: f,
            p: pp,
            sel: rec.id === selectedId,
            hover: rec.id === hoverId,
          });
        }
      }
      prims.sort((a, b) => b.z - a.z);
      for (const pr of prims) drawFace(pr);

      drawWires(eds);
      if (sceneRef.current.showLabels) drawLabels(recs);
    };

    function drawFace(pr: {
      rec: Node3D;
      face: (typeof BOX_FACES)[number];
      p: { sx: number; sy: number }[];
      sel: boolean;
      hover: boolean;
    }) {
      const { rec, face, p, sel, hover } = pr;
      ctx.beginPath();
      ctx.moveTo(p[0].sx, p[0].sy);
      for (let i = 1; i < 4; i++) ctx.lineTo(p[i].sx, p[i].sy);
      ctx.closePath();
      const lightAmt = Math.max(0, dot(face.n, LIGHT));
      const shadeF = 0.5 + lightAmt * 0.7;
      if (rec.container) {
        const baseA = face.kind === "top" ? 0.14 : 0.1;
        ctx.fillStyle = shade(rec.color, shadeF, sel ? baseA + 0.12 : baseA);
        ctx.fill();
        ctx.lineWidth = face.kind === "top" ? 1.25 : 0.75;
        ctx.strokeStyle = shade(rec.color, 1.15, sel ? 0.9 : 0.5);
        if (face.kind === "top") {
          ctx.setLineDash([7, 5]);
          ctx.stroke();
          ctx.setLineDash([]);
        } else ctx.stroke();
      } else {
        let f2 = shadeF;
        if (hover && !sel) f2 += 0.18;
        ctx.fillStyle = shade(rec.color, f2, 0.97);
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = shade(rec.color, 1.5, 0.55);
        ctx.stroke();
        if (sel && face.kind === "top") {
          ctx.lineWidth = 2.5;
          ctx.strokeStyle = "#ffffff";
          ctx.stroke();
          ctx.save();
          ctx.shadowColor = shade(rec.color, 2, 0.9);
          ctx.shadowBlur = 22;
          ctx.stroke();
          ctx.restore();
        }
      }
    }

    function drawFloor() {
      const half = 46;
      const step = 2.2;
      ctx.lineWidth = 1;
      const strokeLine3 = (a: Vec3, b: Vec3, i: number) => {
        const pa = project(basis, a);
        const pb = project(basis, b);
        if (!pa || !pb) return;
        const edge = Math.abs(i) / half;
        const alpha = (1 - edge) * 0.1 + 0.015;
        ctx.strokeStyle = i === 0 ? "rgba(79,209,197,0.22)" : `rgba(90,120,170,${alpha})`;
        ctx.beginPath();
        ctx.moveTo(pa.sx, pa.sy);
        ctx.lineTo(pb.sx, pb.sy);
        ctx.stroke();
      };
      for (let i = -half; i <= half; i += step) {
        strokeLine3({ x: -half, y: 0, z: i }, { x: half, y: 0, z: i }, i);
        strokeLine3({ x: i, y: 0, z: -half }, { x: i, y: 0, z: half }, i);
      }
    }

    function drawWires(eds: { from: string; to: string; color: string }[]) {
      const { selectedId } = sceneRef.current;
      const byId = new Map(sceneRef.current.nodes.map((n) => [n.id, n]));
      ctx.save();
      ctx.lineCap = "round";
      for (const e of eds) {
        const A = byId.get(e.from);
        const B = byId.get(e.to);
        if (!A || !B) continue;
        const ga = geom(A);
        const gb = geom(B);
        const pa: Vec3 = { x: ga.x0 + ga.w / 2, y: ga.y + ga.thick, z: ga.z0 + ga.d / 2 };
        const pb: Vec3 = { x: gb.x0 + gb.w / 2, y: gb.y + gb.thick, z: gb.z0 + gb.d / 2 };
        const involved = selectedId != null && (e.from === selectedId || e.to === selectedId);
        const dim = selectedId != null && !involved;
        const lift = 1.4 + Math.min(6, Math.hypot(pa.x - pb.x, pa.y - pb.y, pa.z - pb.z) * 0.25);
        const mid: Vec3 = {
          x: (pa.x + pb.x) / 2,
          y: Math.max(pa.y, pb.y) + lift,
          z: (pa.z + pb.z) / 2,
        };
        const pts: { sx: number; sy: number }[] = [];
        let ok = true;
        for (let s = 0; s <= 20; s++) {
          const q = project(basis, bezier(pa, mid, pb, s / 20));
          if (!q) {
            ok = false;
            break;
          }
          pts.push(q);
        }
        if (!ok || pts.length < 2) continue;
        ctx.beginPath();
        ctx.moveTo(pts[0].sx, pts[0].sy);
        for (let s = 1; s < pts.length; s++) ctx.lineTo(pts[s].sx, pts[s].sy);
        ctx.globalAlpha = dim ? 0.08 : involved ? 0.95 : 0.4;
        ctx.lineWidth = involved ? 2.2 : 1.3;
        ctx.strokeStyle = e.color;
        if (involved) {
          ctx.shadowColor = e.color;
          ctx.shadowBlur = 12;
        }
        ctx.stroke();
        ctx.shadowBlur = 0;
      }
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    function drawLabels(recs: Node3D[]) {
      const { selectedId } = sceneRef.current;
      const items: { rec: Node3D; sx: number; sy: number; z: number; wpx: number }[] = [];
      for (const rec of recs) {
        const g = geom(rec);
        const c: Vec3 = { x: g.x0 + g.w / 2, y: g.y + g.thick, z: g.z0 + g.d / 2 };
        const p = project(basis, c);
        if (!p) continue;
        if (
          p.sx < -80 ||
          p.sx > sizeRef.current.W + 80 ||
          p.sy < -40 ||
          p.sy > sizeRef.current.H + 40
        )
          continue;
        const wpx = (g.w / p.z) * basis.focal;
        items.push({ rec, sx: p.sx, sy: p.sy, z: p.z, wpx });
      }
      items.sort((a, b) => b.z - a.z);
      ctx.textBaseline = "middle";
      for (const it of items) {
        const { rec, sx, sy, wpx } = it;
        const dimmed = selectedId != null && rec.id !== selectedId;
        if (rec.container) {
          if (wpx < 60) continue;
          const g = geom(rec);
          const corner = project(basis, { x: g.x0, y: g.y + g.thick, z: g.z0 });
          const at = corner ?? { sx, sy };
          ctx.globalAlpha = dimmed ? 0.3 : 0.85;
          ctx.font = "600 12px ui-sans-serif, system-ui, sans-serif";
          ctx.textAlign = "left";
          ctx.fillStyle = shade(rec.color, 1.5, 1);
          ctx.fillText(`${rec.icon}  ${rec.name}`, at.sx + 6, at.sy - 8);
          ctx.globalAlpha = 1;
          continue;
        }
        if (wpx < 22) continue;
        const showName = wpx > 46;
        const iconPx = labelFontPx(wpx, 0.32, 14, 30); // prominent, recognizable
        ctx.globalAlpha = dimmed ? 0.25 : 1;
        ctx.textAlign = "center";
        ctx.font = `${iconPx}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
        ctx.fillText(rec.icon, sx, sy - (showName ? iconPx * 0.4 : 0));
        if (showName) {
          const namePx = labelFontPx(wpx, 0.09, 10, 15);
          ctx.font = `600 ${namePx}px ui-sans-serif, system-ui, sans-serif`;
          const tw = ctx.measureText(rec.name).width;
          const chipY = sy + iconPx * 0.5;
          if (!dimmed) {
            const padx = 6;
            const h = namePx + 5;
            roundRect(sx - tw / 2 - padx, chipY - h / 2, tw + padx * 2, h, 4);
            ctx.fillStyle = "rgba(6,10,18,0.72)";
            ctx.fill();
          }
          ctx.fillStyle = dimmed ? "#5a6884" : "#eaf1fb";
          ctx.fillText(rec.name, sx, chipY);
        }
        ctx.globalAlpha = 1;
      }
    }

    function roundRect(x: number, y: number, w: number, h: number, r: number) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }

    // ---- render-on-demand loop: repaint only when dirty (or auto-orbiting) ----
    const loop = () => {
      if (autoOrbitRef.current) {
        camRef.current.az += 0.0016;
        dirtyRef.current = true;
      }
      if (dirtyRef.current) {
        dirtyRef.current = false;
        draw();
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);

    return () => {
      ro.disconnect();
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("contextmenu", onCtx);
    };
  }, []);

  if (!ENABLED) return null;
  const dockBtn: React.CSSProperties = {
    pointerEvents: "auto",
    font: "600 11px ui-sans-serif, system-ui, sans-serif",
    color: "#c7d2e4",
    background: "rgba(14,21,38,0.72)",
    border: "1px solid rgba(120,150,200,0.18)",
    borderRadius: 8,
    padding: "6px 10px",
    cursor: "pointer",
  };
  return (
    <>
      <canvas
        ref={canvasRef}
        className="orbit3d-layer"
        aria-hidden="true"
        style={{ position: "absolute", inset: 0, cursor: "grab", touchAction: "none", zIndex: 10 }}
      />
      <div
        style={{
          position: "absolute",
          bottom: 20,
          left: "50%",
          transform: "translateX(-50%)",
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: 8,
          borderRadius: 12,
          background: "rgba(14,21,38,0.72)",
          border: "1px solid rgba(120,150,200,0.18)",
          backdropFilter: "blur(10px)",
          zIndex: 11,
        }}
      >
        <button
          type="button"
          style={{ ...dockBtn, ...(autoOrbit ? { color: "#04140f", background: "#4fd1c5" } : {}) }}
          onClick={() => setAutoOrbit((v) => !v)}
        >
          ◐ orbit
        </button>
        <button
          type="button"
          style={{ ...dockBtn, ...(showLabels ? { color: "#04140f", background: "#4fd1c5" } : {}) }}
          onClick={() => setShowLabels((v) => !v)}
        >
          A labels
        </button>
        <label
          style={{
            pointerEvents: "auto",
            display: "flex",
            alignItems: "center",
            gap: 8,
            font: "11px ui-sans-serif, system-ui, sans-serif",
            color: "#7c8aa5",
            padding: "0 6px",
          }}
        >
          explode
          <input
            type="range"
            min={0.4}
            max={3.2}
            step={0.05}
            value={explode}
            onChange={(e) => setExplode(parseFloat(e.target.value))}
          />
        </label>
      </div>
    </>
  );
};
