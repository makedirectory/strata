"use client";
import { useRef, useCallback } from "react";
import type { ResourceInstance, Relationship, Viewport, Account } from "../aws/model";

/** A snapshot of the canvas-relevant state. */
export interface HistoryState {
  resources: ResourceInstance[];
  relationships: Relationship[];
  viewport: Viewport;
  accounts: Account[];
  graphId: string;
}

/**
 * Snapshot a state for history via STRUCTURAL SHARING, not a deep clone.
 *
 * The store treats every state field as immutable — mutations always produce
 * new arrays/objects (`map`/`filter`/spread) and never edit elements in place —
 * so history entries can safely retain references to the committed arrays and
 * element objects. A shallow copy isolates only the top-level container.
 *
 * This is the Phase 4 "patch-based history" win: undo memory is O(changed)
 * (a handful of new array wrappers per step) instead of O(whole graph). The old
 * `structuredClone` deep-copied every resource on every commit/undo/redo — MBs
 * per step at a few thousand nodes.
 */
function snapshot<T extends HistoryState>(state: T): T {
  return { ...state };
}

export function useHistory<T extends HistoryState>() {
  const historyRef = useRef<{
    past: T[];
    present: T | null;
    future: T[];
  }>({
    past: [],
    present: null,
    future: [],
  });

  const commit = useCallback((state: T) => {
    const h = historyRef.current;

    // If this is the first commit, just set present
    if (!h.present) {
      h.present = snapshot(state);
      return;
    }

    // Push current state to past
    h.past.push(h.present);

    // Limit history size
    if (h.past.length > 100) {
      h.past.shift();
    }

    // Set new present and clear future
    h.present = snapshot(state);
    h.future = [];
  }, []);

  const undo = useCallback((): T | null => {
    const h = historyRef.current;

    if (h.past.length === 0) return null;

    if (h.present) {
      h.future.unshift(h.present);
    }

    const prev = h.past.pop();
    if (prev) {
      h.present = prev;
      return snapshot(prev);
    }

    return null;
  }, []);

  const redo = useCallback((): T | null => {
    const h = historyRef.current;

    if (h.future.length === 0) return null;

    if (h.present) {
      h.past.push(h.present);
    }

    const next = h.future.shift();
    if (next) {
      h.present = next;
      return snapshot(next);
    }

    return null;
  }, []);

  const canUndo = useCallback(() => historyRef.current.past.length > 0, []);
  const canRedo = useCallback(() => historyRef.current.future.length > 0, []);

  return {
    commit,
    undo,
    redo,
    canUndo,
    canRedo,
  };
}
