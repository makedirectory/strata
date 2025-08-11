"use client";
import React, { useEffect } from "react";
import { useFlow } from "../hooks/useFlow";

export const Canvas: React.FC = () => {
  const {
    worldRef, svgRef, minimapRef,
    addNodeFromPalette, select, onWheelZoom,
    onMouseMove, onMouseUp, onCanvasMouseDown, onCanvasClick,
    draw, drawMinimap, state,
    toggleMode, removeSelection, duplicateSelection, groupIntoVPC, setSpacePressed
  } = useFlow();

  // Document-level drag and drop
  useEffect(() => {
    const onDragOver = (e: DragEvent) => { e.preventDefault(); };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      const raw = e.dataTransfer?.getData('application/json');
      if (!raw) return;
      try { 
        const item = JSON.parse(raw);
        addNodeFromPalette(item.type, e.clientX, e.clientY);
      } catch {}
    };
    document.addEventListener('dragover', onDragOver, false);
    document.addEventListener('drop', onDrop, false);
    return () => {
      document.removeEventListener('dragover', onDragOver, false);
      document.removeEventListener('drop', onDrop, false);
    };
  }, [addNodeFromPalette]);

  // Redraw when state changes
  useEffect(() => {
    draw();
    drawMinimap();
  }, [state.nodes, state.edges, state.pan, state.mode, draw, drawMinimap]);

  // Mouse events
  useEffect(() => {
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [onMouseMove, onMouseUp]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const ae = document.activeElement as HTMLElement | null;
      const tag = ae?.tagName?.toLowerCase();
      const typing = ae && (tag === 'input' || tag === 'textarea' || tag === 'select' || ae.isContentEditable);
      if (typing) return;

      if (e.code === "Space") { 
        document.body.style.cursor = "grab"; 
        setSpacePressed(true); 
      }
      if (e.key === "c" || e.key === "C") toggleMode();
      if (e.key === "Delete" || e.key === "Backspace") removeSelection();
      if (e.key === "d" || e.key === "D") duplicateSelection();
      if (e.key === "g" || e.key === "G") groupIntoVPC();
    };
    
    const onKeyUp = (e: KeyboardEvent) => { 
      if (e.code === "Space") { 
        document.body.style.cursor = "default"; 
        setSpacePressed(false); 
      }
    };
    
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [toggleMode, removeSelection, duplicateSelection, groupIntoVPC, setSpacePressed]);

  return (
    <>
      <svg className="edges" ref={svgRef} />
      <div 
        className="world" 
        ref={worldRef} 
        onClick={() => select(null)}
        onMouseDown={(e) => onCanvasMouseDown(e)}
        onWheel={onWheelZoom}
      />
      <div
        className="overlay"
        onClick={onCanvasClick}
      />
      <div className="minimap"><canvas ref={minimapRef} /></div>
    </>
  );
};
