/**
 * Runtime source of truth for which canvas renderer is active. Initialised from
 * `NEXT_PUBLIC_STRATA_CANVAS_RENDERER` (dev override), then driven at runtime by
 * the in-app 2D⇄3D view toggle. Every renderer resolves the mode through here so
 * they can't double-render — an alternate mode DISABLES the DOM structural render
 * instead of stacking on top of it.
 *
 * A tiny external store (subscribe/getSnapshot) so components can `useRenderMode`
 * and the imperative DOM renderer can read `getRenderMode()` at draw time. The
 * server snapshot equals the client's initial value (both from the env), so
 * there's no hydration mismatch; persistence is restored in a mount effect.
 */
import { useSyncExternalStore } from "react";

export type RenderMode = "dom" | "canvas" | "webgl" | "3d";

export const RENDER_MODE_STORAGE_KEY = "strata.renderMode";

/** Initial mode from the env flag (deterministic on server + client first paint). */
function fromEnv(): RenderMode {
  const v = process.env.NEXT_PUBLIC_STRATA_CANVAS_RENDERER;
  if (v === "webgl" || v === "pixi") return "webgl";
  if (v === "3d") return "3d";
  if (v === "1" || v === "canvas") return "canvas";
  return "dom";
}

let current: RenderMode = fromEnv();
const listeners = new Set<() => void>();

export function getRenderMode(): RenderMode {
  return current;
}

/** Set the active render mode and persist it; notifies subscribers. */
export function setRenderMode(mode: RenderMode): void {
  if (mode === current) return;
  current = mode;
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(RENDER_MODE_STORAGE_KEY, mode);
  } catch {
    // ignore storage failures (private mode, quota, etc.)
  }
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Reactive hook: re-renders the component whenever the render mode changes. */
export function useRenderMode(): RenderMode {
  return useSyncExternalStore(subscribe, getRenderMode, getRenderMode);
}

/** True when the default DOM structural renderer should paint (mode === "dom"). */
export function isDomRenderActive(): boolean {
  return current === "dom";
}
