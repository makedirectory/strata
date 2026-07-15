"use client";
import React, { useEffect, useState } from "react";
import { FlowProvider, useFlow, useFlowCanvas } from "../../../hooks/useFlow";
import { Canvas } from "../../../components/Canvas";
import { setRenderMode } from "../../../canvas/renderMode";
import { generateSyntheticGraph } from "../../../canvas/perfHarness";

/**
 * Dev-only performance harness for the WebGL "2D⚡" layer. Generates N synthetic
 * nodes, forces WebGL mode, and drives an automated pan/zoom sweep while sampling
 * requestAnimationFrame frame times — reporting median / p95 ms-per-frame and fps
 * at 1k / 2k / 5k. Not a CI gate; open /perf and click "Run 1k/2k/5k".
 */
interface Row {
  nodes: number;
  frames: number;
  medianMs: number;
  p95Ms: number;
  fps: number;
}

function makeRow(nodes: number, deltas: number[]): Row {
  const sorted = [...deltas].sort((a, b) => a - b);
  const med = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
  const avg = deltas.reduce((s, d) => s + d, 0) / (deltas.length || 1);
  return {
    nodes,
    frames: deltas.length,
    medianMs: +med.toFixed(2),
    p95Ms: +p95.toFixed(2),
    fps: Math.round(1000 / (avg || 16.7)),
  };
}

const RUN_MS = 2000;

function Harness() {
  const { loadGraphObject, fitToView } = useFlow();
  const { viewport, setViewport } = useFlowCanvas();
  const [results, setResults] = useState<Row[]>([]);
  const [running, setRunning] = useState(false);
  const [preview, setPreview] = useState(1000);

  // Force the WebGL layer for this harness; restore the default on leave.
  useEffect(() => {
    setRenderMode("webgl");
    return () => setRenderMode("dom");
  }, []);

  // Show a graph immediately so the canvas isn't blank before a run.
  useEffect(() => {
    loadGraphObject(generateSyntheticGraph(preview));
  }, [preview, loadGraphObject]);

  const runOne = (count: number) =>
    new Promise<Row>((resolve) => {
      loadGraphObject(generateSyntheticGraph(count));
      const deltas: number[] = [];
      let warm = 0;
      let last = 0;
      let start = 0;
      let base = viewport;
      const step = (t: number) => {
        // Warm-up: let the scene build + fit to view, then capture the base camera.
        if (warm < 30) {
          if (warm === 10) fitToView();
          warm++;
          last = t;
          base = viewport;
          requestAnimationFrame(step);
          return;
        }
        if (start === 0) start = t;
        deltas.push(t - last);
        last = t;
        const k = (t - start) / RUN_MS;
        setViewport({
          x: base.x + Math.sin(k * Math.PI * 2) * 500,
          y: base.y + Math.cos(k * Math.PI * 2) * 300,
          scale: base.scale * (1 + 0.25 * Math.sin(k * Math.PI * 4)),
        });
        if (t - start < RUN_MS) requestAnimationFrame(step);
        else resolve(makeRow(count, deltas));
      };
      requestAnimationFrame(step);
    });

  const runAll = async () => {
    setRunning(true);
    setResults([]);
    const rows: Row[] = [];
    for (const count of [1000, 2000, 5000]) {
      const row = await runOne(count);
      rows.push(row);
      setResults([...rows]);
    }
    // eslint-disable-next-line no-console
    console.table(rows);
    setRunning(false);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", color: "#c7d2e4" }}>
      <div
        style={{
          padding: "12px 16px",
          borderBottom: "1px solid #203055",
          display: "flex",
          gap: 16,
          alignItems: "center",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
          fontSize: 13,
          background: "#0b1020",
        }}
      >
        <strong>WebGL 2D⚡ perf harness</strong>
        <button
          type="button"
          disabled={running}
          onClick={runAll}
          style={{
            background: running ? "#1b2644" : "#4fd1c5",
            color: running ? "#8ba0c8" : "#04140f",
            border: "none",
            borderRadius: 8,
            padding: "6px 12px",
            fontWeight: 700,
            cursor: running ? "default" : "pointer",
          }}
        >
          {running ? "Running…" : "Run 1k / 2k / 5k"}
        </button>
        <span style={{ color: "#7c8aa5" }}>preview:</span>
        {[1000, 2000, 5000].map((n) => (
          <button
            key={n}
            type="button"
            disabled={running}
            onClick={() => setPreview(n)}
            style={{
              background: preview === n ? "#4fd1c5" : "transparent",
              color: preview === n ? "#04140f" : "#8ba0c8",
              border: "1px solid #203055",
              borderRadius: 8,
              padding: "5px 10px",
              cursor: "pointer",
            }}
          >
            {n / 1000}k
          </button>
        ))}
        {results.length > 0 && (
          <div
            style={{ display: "flex", gap: 14, marginLeft: 8, fontVariantNumeric: "tabular-nums" }}
          >
            {results.map((r) => (
              <span key={r.nodes}>
                <b>{r.nodes / 1000}k</b>: {r.medianMs}ms med · {r.p95Ms}ms p95 · {r.fps} fps
              </span>
            ))}
          </div>
        )}
      </div>
      <main className="canvas-wrap" style={{ position: "relative", flex: 1, minHeight: 0 }}>
        <Canvas />
      </main>
    </div>
  );
}

export default function PerfPage() {
  return (
    <FlowProvider>
      <Harness />
    </FlowProvider>
  );
}
