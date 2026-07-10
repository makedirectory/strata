/**
 * Single source of truth for which canvas renderer is active, read from
 * `NEXT_PUBLIC_STRATA_CANVAS_RENDERER`. Every renderer (the default DOM path, the
 * Canvas-2D spike, the PixiJS/WebGL layer, the 3D orbit view) resolves the mode
 * through here so they can't double-render — an alternate mode DISABLES the DOM
 * structural render instead of stacking on top of it.
 */
export type RenderMode = "dom" | "canvas" | "webgl" | "3d";

/** Resolve the active render mode from the env flag (default "dom"). */
export function renderMode(): RenderMode {
  const v = process.env.NEXT_PUBLIC_STRATA_CANVAS_RENDERER;
  if (v === "webgl" || v === "pixi") return "webgl";
  if (v === "3d") return "3d";
  if (v === "1" || v === "canvas") return "canvas";
  return "dom";
}

/** True when the default DOM structural renderer should paint (mode === "dom"). */
export const DOM_RENDER_ACTIVE = renderMode() === "dom";
