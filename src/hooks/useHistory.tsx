"use client";
import { useRef, useCallback } from 'react';

export interface HistoryState {
  nodes: any[];
  edges: any[];
  pan: { x: number; y: number; scale: number };
  nextId: number;
}

export function useHistory<T extends HistoryState>() {
  const historyRef = useRef<{
    past: T[];
    present: T | null;
    future: T[];
  }>({ 
    past: [], 
    present: null, 
    future: [] 
  });

  const commit = useCallback((state: T) => {
    const h = historyRef.current;
    
    // If this is the first commit, just set present
    if (!h.present) {
      h.present = JSON.parse(JSON.stringify(state));
      return;
    }
    
    // Push current state to past
    h.past.push(h.present);
    
    // Limit history size
    if (h.past.length > 100) {
      h.past.shift();
    }
    
    // Set new present and clear future
    h.present = JSON.parse(JSON.stringify(state));
    h.future = [];
  }, []);

  const undo = useCallback((): T | null => {
    const h = historyRef.current;
    
    if (h.past.length === 0) return null;
    
    // Move current present to future
    if (h.present) {
      h.future.unshift(h.present);
    }
    
    // Get previous state
    const prev = h.past.pop();
    if (prev) {
      h.present = prev;
      return JSON.parse(JSON.stringify(prev));
    }
    
    return null;
  }, []);

  const redo = useCallback((): T | null => {
    const h = historyRef.current;
    
    if (h.future.length === 0) return null;
    
    // Move current present to past
    if (h.present) {
      h.past.push(h.present);
    }
    
    // Get next state
    const next = h.future.shift();
    if (next) {
      h.present = next;
      return JSON.parse(JSON.stringify(next));
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
    canRedo
  };
}