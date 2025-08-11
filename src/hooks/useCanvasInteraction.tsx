"use client";
import { useRef, useCallback } from 'react';
import type { FlowNode, Pan } from '../types';

export function useCanvasInteraction() {
  const dragRef = useRef<{ nodeId: string; dx: number; dy: number } | null>(null);
  const panningRef = useRef(false);
  const spacePressed = useRef(false);
  const connectStartRef = useRef<string | null>(null);

  const screenToWorld = useCallback((pt: { x: number; y: number }, pan: Pan) => ({
    x: (pt.x - pan.x) / pan.scale,
    y: (pt.y - pan.y) / pan.scale
  }), []);

  const onNodeMouseDown = useCallback((e: React.MouseEvent, node: FlowNode, pan: Pan, commitState?: () => void) => {
    e.preventDefault();
    e.stopPropagation();
    
    // Commit state before starting drag
    if (commitState) {
      commitState();
    }
    
    const startX = (e as any).clientX;
    const startY = (e as any).clientY;
    const dx = startX - (pan.x + node.x * pan.scale);
    const dy = startY - (pan.y + node.y * pan.scale);
    dragRef.current = { nodeId: node.id, dx, dy };
  }, []);

  const onCanvasMouseDown = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const isNode = target.closest('.node') !== null;
    const isPort = target.closest('.port') !== null;

    // Don't handle panning if clicking on nodes or ports
    if (isNode || isPort) {
      return;
    }
    // Handle panning for canvas background only - middle mouse or space+left mouse
    if (e.button === 1 || (e.button === 0 && spacePressed.current)) {
      panningRef.current = true;
      e.preventDefault();
      return;
    }
  }, []);

  const onMouseMove = useCallback((
    e: MouseEvent, 
    nodes: FlowNode[], 
    pan: Pan, 
    updateNode: (id: string, updates: Partial<FlowNode>) => void,
    updatePan: (newPan: Pan) => void
  ) => {
    if (dragRef.current) {
      const n = nodes.find(n => n.id === dragRef.current!.nodeId);
      if (!n) return;
      const nx = ((e.clientX - pan.x - dragRef.current.dx) / pan.scale);
      const ny = ((e.clientY - pan.y - dragRef.current.dy) / pan.scale);
      updateNode(n.id, {
        x: Math.round(nx / 4) * 4,
        y: Math.round(ny / 4) * 4
      });
    } else if (panningRef.current) {
      updatePan({
        ...pan,
        x: pan.x + (e as any).movementX,
        y: pan.y + (e as any).movementY
      });
    }
  }, []);

  const onMouseUp = useCallback((commitState?: () => void) => {
    if (dragRef.current && commitState) {
      commitState(); // Commit when dragging ends
    }
    dragRef.current = null;
    panningRef.current = false;
  }, []);

  const onWheelZoom = useCallback((e: React.WheelEvent, pan: Pan, updatePan: (newPan: Pan) => void) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const scale = pan.scale * (e.deltaY < 0 ? 1.1 : 0.9);
      const clamped = Math.min(2.0, Math.max(0.4, scale));
      updatePan({ ...pan, scale: clamped });
    }
  }, []);

  const setSpacePressed = useCallback((pressed: boolean) => {
  spacePressed.current = pressed;
  }, []);

  const onConnect = useCallback((nodeId: string, type: 'start' | 'end', connectAction: (from: string, to: string) => void) => {
    if (type === 'start') {
      connectStartRef.current = nodeId;
    } else if (type === 'end' && connectStartRef.current && connectStartRef.current !== nodeId) {
      connectAction(connectStartRef.current, nodeId);
      connectStartRef.current = null;
    }
  }, []);

  const fitToView = useCallback((
    nodes: FlowNode[], 
    worldRef: React.RefObject<HTMLDivElement>, 
    updatePan: (newPan: Pan) => void
  ) => {
    if (nodes.length === 0) {
      updatePan({ x: 200, y: 120, scale: 1 });
      return;
    }
    
    const xs = nodes.map(n => n.x);
    const ys = nodes.map(n => n.y);
    const xe = nodes.map(n => n.x + n.w);
    const ye = nodes.map(n => n.y + n.h);
    const minx = Math.min(...xs);
    const miny = Math.min(...ys);
    const maxx = Math.max(...xe);
    const maxy = Math.max(...ye);
    const worldW = maxx - minx;
    const worldH = maxy - miny;
    
    const view = (worldRef.current!.parentElement as HTMLElement).getBoundingClientRect();
    const margin = 80;
    const sx = (view.width - margin * 2) / worldW;
    const sy = (view.height - margin * 2) / worldH;
    const scale = Math.max(0.4, Math.min(1.6, Math.min(sx, sy)));
    const centerX = (view.width - worldW * scale) / 2 - minx * scale;
    const centerY = (view.height - worldH * scale) / 2 - miny * scale;
    
    updatePan({ x: centerX, y: centerY, scale });
  }, []);

  const center = useCallback((pan: Pan, updatePan: (newPan: Pan) => void) => {
    updatePan({ ...pan, x: 200, y: 120 });
  }, []);

  return {
    onNodeMouseDown,
    onCanvasMouseDown,
    onMouseMove,
    onMouseUp,
    onWheelZoom,
    setSpacePressed,
    onConnect,
    screenToWorld,
    fitToView,
    center
  };
}