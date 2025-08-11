"use client";
import { useState, useCallback, useRef } from 'react';
import type { FlowNode, FlowEdge, Pan, NodeType } from '../types';
import { useHistory, type HistoryState } from './useHistory';

interface FlowState extends HistoryState {
  nodes: FlowNode[];
  edges: FlowEdge[];
  pan: Pan;
  nextId: number;
}

interface SelectionNode { type: "node"; id: string; node: FlowNode }
interface SelectionEdge { type: "edge"; id: string; edge: FlowEdge; edgeFromTo: { fromName: string; toName: string } }
type Selection = SelectionNode | SelectionEdge | null;

export function useFlowStore() {
  const [nodes, setNodes] = useState<FlowNode[]>([]);
  const [edges, setEdges] = useState<FlowEdge[]>([]);
  const [pan, setPan] = useState<Pan>({ x: 200, y: 120, scale: 1 });
  const [mode, setMode] = useState<"move"|"connect">("move");
  const [selection, setSelection] = useState<Selection>(null);
  const nextIdRef = useRef<number>(1);
  const isRestoringRef = useRef<boolean>(false);

  const { commit, undo, redo, canUndo, canRedo } = useHistory<FlowState>();

  const uid = useCallback(() => String(nextIdRef.current++), []);

  const getCurrentState = useCallback((): FlowState => ({
    nodes,
    edges,
    pan,
    nextId: nextIdRef.current
  }), [nodes, edges, pan]);

  const applyState = useCallback((state: FlowState) => {
    isRestoringRef.current = true;
    setNodes(state.nodes);
    setEdges(state.edges);
    setPan(state.pan);
    nextIdRef.current = state.nextId;
    setSelection(null);
    // Reset the flag after state updates
    setTimeout(() => {
      isRestoringRef.current = false;
    }, 0);
  }, []);

  const commitCurrentState = useCallback(() => {
    // Don't commit if we're in the middle of restoring state from undo/redo
    if (isRestoringRef.current) return;
    commit(getCurrentState());
  }, [commit, getCurrentState]);

  const undoAction = useCallback(() => {
    const prevState = undo();
    if (prevState) {
      applyState(prevState);
    }
  }, [undo, applyState]);

  const redoAction = useCallback(() => {
    const nextState = redo();
    if (nextState) {
      applyState(nextState);
    }
  }, [redo, applyState]);

  const addNode = useCallback((type: NodeType, x: number, y: number, props: Partial<FlowNode["props"]> = {}) => {
    commitCurrentState(); // Commit before making changes
    
    const id = uid();
    const node: FlowNode = {
      id,
      type,
      x,
      y,
      w: 200,
      h: 96,
      props: {
        name: `${props.name || type} ${id}`,
        cidr: props.cidr || "",
        public: !!props.public,
        az: props.az || "",
        notes: props.notes || ""
      }
    };
    
    setNodes(n => [...n, node]);
    setSelection({ type: "node", id, node });
  }, [commitCurrentState, uid]);

  const removeSelection = useCallback(() => {
    if (!selection) return;
    
    commitCurrentState(); // Commit before making changes
    
    if (selection.type === "node") {
      setNodes(ns => ns.filter(n => n.id !== selection.id));
      setEdges(es => es.filter(e => e.from !== selection.id && e.to !== selection.id));
    } else {
      setEdges(es => es.filter(e => e.id !== selection.id));
    }
    setSelection(null);
  }, [selection, commitCurrentState]);

  const updateNode = useCallback((nodeId: string, updates: Partial<FlowNode>) => {
    // Don't commit during live updates (like dragging) - only commit when done
    setNodes(ns => ns.map(n => n.id === nodeId ? { ...n, ...updates } : n));
  }, []);

  const updateNodeProps = useCallback((nodeId: string, propUpdates: Partial<FlowNode["props"]>) => {
    commitCurrentState(); // Commit before making changes
    setNodes(ns => ns.map(n => n.id === nodeId ? { ...n, props: { ...n.props, ...propUpdates } } : n));
  }, [commitCurrentState]);

  const connect = useCallback((fromId: string, toId: string, rel: FlowEdge["rel"] = "depends_on") => {
    if (fromId === toId) return;
    
    commitCurrentState(); // Commit before making changes
    
    const id = uid();
    const edge: FlowEdge = { id, from: fromId, to: toId, rel };
    setEdges(es => [...es, edge]);
    
    const fromNode = nodes.find(n => n.id === fromId);
    const toNode = nodes.find(n => n.id === toId);
    const fromName = fromNode ? `${fromNode.props.name} (${fromNode.type})` : fromId;
    const toName = toNode ? `${toNode.props.name} (${toNode.type})` : toId;
    
    setSelection({ type: "edge", id, edge, edgeFromTo: { fromName, toName } });
  }, [commitCurrentState, uid, nodes]);

  const duplicateSelection = useCallback(() => {
    if (!selection || selection.type !== "node") return;
    
    const n = nodes.find(n => n.id === selection.id);
    if (!n) return;
    
    addNode(n.type, n.x + 24, n.y + 24, n.props);
  }, [selection, nodes, addNode]);

  const clear = useCallback(() => {
    if (confirm('Clear canvas?')) {
      commitCurrentState(); // Commit before making changes
      setNodes([]);
      setEdges([]);
      setSelection(null);
    }
  }, [commitCurrentState]);

  return {
    // State
    nodes,
    edges,
    pan,
    mode,
    selection,
    nextId: nextIdRef.current,
    
    // State setters
    setNodes,
    setEdges,
    setPan,
    setMode,
    setSelection,
    
    // Actions
    addNode,
    removeSelection,
    updateNode,
    updateNodeProps,
    connect,
    duplicateSelection,
    clear,
    
    // History
    undo: undoAction,
    redo: redoAction,
    canUndo,
    canRedo,
    commitCurrentState,
    
    // Utilities
    uid,
    getCurrentState,
    applyState
  };
}