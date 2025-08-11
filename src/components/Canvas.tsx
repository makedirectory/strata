"use client";
import React, { useEffect, useRef } from "react";
import { useFlow } from "../hooks/useFlow";

export const Canvas: React.FC = () => {
  const {
    worldRef, svgRef, minimapRef,
    addNodeFromPalette, select, onNodeMouseDown, onWheelZoom,
    onMouseMove, onMouseUp, onCanvasMouseDown, onCanvasClick,
    draw, drawMinimap,
    toggleMode, removeSelection, duplicateSelection, groupIntoVPC
  } = useFlow();

  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const wrap = wrapRef.current!;
    const onDragOver = (e: DragEvent) => { e.preventDefault(); };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      const data = e.dataTransfer?.getData("application/json");
      if (!data) return;
      const item = JSON.parse(data);
      const rect = wrap.getBoundingClientRect();
      const client = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      addNodeFromPalette(item, client);
    };
    wrap.addEventListener("dragover", onDragOver);
    wrap.addEventListener("drop", onDrop);
    return () => {
      wrap.removeEventListener("dragover", onDragOver);
      wrap.removeEventListener("drop", onDrop);
    };
  }, [addNodeFromPalette]);

  useEffect(() => { draw(); drawMinimap(); });

  useEffect(() => {
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [onMouseMove, onMouseUp]);

  // keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space") document.body.style.cursor = "grab";
      if (e.key === "c" || e.key === "C") toggleMode();
      if (e.key === "Delete" || e.key === "Backspace") removeSelection();
      if (e.key === "d" || e.key === "D") duplicateSelection();
      if (e.key === "g" || e.key === "G") groupIntoVPC();
    };
    const onKeyUp = (e: KeyboardEvent) => { if (e.code === "Space") document.body.style.cursor = "default"; };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [toggleMode, removeSelection, duplicateSelection, groupIntoVPC]);

  return (
    <>
      <svg className="edges" ref={svgRef} />
      <div className="world" ref={worldRef} onClick={() => select(null)} />
      <div
        ref={wrapRef}
        className="overlay"
        onMouseDown={(e) => onCanvasMouseDown(e)}
        onClick={onCanvasClick}
        onWheel={onWheelZoom}
      />
      <div className="minimap"><canvas ref={minimapRef} /></div>
    </>
  );
};
