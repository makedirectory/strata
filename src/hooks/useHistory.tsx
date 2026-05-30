"use client";
import { useRef, useCallback } from "react";
import type { ResourceInstance, Relationship, Viewport, Account } from "../aws/model";

/** A deep-cloneable snapshot of the canvas-relevant state. */
export interface HistoryState {
  resources: ResourceInstance[];
  relationships: Relationship[];
  viewport: Viewport;
  accounts: Account[];
  graphId: string;
}

/**
 * Deep-clone a snapshot so history entries are isolated from live React state.
 *
 * Uses `structuredClone` when available (modern browsers / Node 17+) and falls
 * back to JSON round-tripping. NOTE: the history model (`HistoryState`) must
 * remain JSON-serializable — Functions, Dates, and Symbols are not preserved by
 * the fallback path.
 */
function clone<T extends HistoryState>(state: T): T {
  return typeof structuredClone === "function"
    ? structuredClone(state)
    : (JSON.parse(JSON.stringify(state)) as T);
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
      h.present = clone(state);
      return;
    }

    // Push current state to past
    h.past.push(h.present);

    // Limit history size
    if (h.past.length > 100) {
      h.past.shift();
    }

    // Set new present and clear future
    h.present = clone(state);
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
      return clone(prev);
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
      return clone(next);
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
