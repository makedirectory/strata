"use client";
import React from "react";
import type { CloudMapResult } from "../aws/cloudMap";
import type { CloudProvider } from "../aws/types";

/**
 * Migrate — multi-cloud equivalence panel (presentation only).
 *
 * A target-provider picker plus an honest summary of a `mapToCloud(graph,
 * target)` run: how many resources were rewritten and the explicit list of
 * resources that have no equivalent on the target provider. Pure and
 * props-driven — it imports only its engine types + React and has NO
 * store/context coupling, so the integrator can mount it anywhere (right
 * sidebar section or a floating canvas overlay) and wire `onMap`/`result`.
 * Uses the existing CSS class vocabulary (inspector/section/kv/badge/finding…)
 * plus light Tailwind utilities so it sits consistently beside
 * Inspector/ReviewPanel/DriftPanel.
 */
export interface MigratePanelProps {
  /** Called when the user picks a target provider to map onto. */
  onMap: (target: CloudProvider) => void;
  /** The latest mapping result, or null before the first run. */
  result: CloudMapResult | null;
  /** Optional currently-selected target (drives the active picker state). */
  target?: CloudProvider;
  /** Optional click handler so a host can focus an unmapped resource. */
  onSelectResource?: (resourceId: string) => void;
}

const PROVIDERS: ReadonlyArray<{ id: CloudProvider; label: string }> = [
  { id: "aws", label: "AWS" },
  { id: "gcp", label: "Google Cloud" },
  { id: "azure", label: "Azure" },
];

export const MigratePanel: React.FC<MigratePanelProps> = ({
  onMap,
  result,
  target,
  onSelectResource,
}) => {
  const mappedCount = result ? result.graph.resources.length : 0;
  const unmappedCount = result ? result.unmapped.length : 0;

  return (
    <div className="inspector migrate-panel">
      {/* ---- target picker ---- */}
      <div className="section">
        <div className="ins-panel-head">
          <strong>Migrate to another cloud</strong>
          {result && (
            <span
              className="badge"
              title="Resources rewritten to the target provider's equivalents"
            >
              {mappedCount} mapped
            </span>
          )}
        </div>
        <div className="palette-providers" role="group" aria-label="Target cloud provider">
          {PROVIDERS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`chip${target === p.id ? " chip--active" : ""}`}
              aria-pressed={target === p.id}
              onClick={() => onMap(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <p className="help">
          Maps every resource onto the target provider&rsquo;s closest service by category and
          capability. Anything with no equivalent is listed below, never silently dropped.
        </p>
      </div>

      {/* ---- honest unmapped report ---- */}
      {result && (
        <div className="section">
          <div className="ins-panel-head">
            <strong>Unmapped</strong>
            <span
              className={`badge${unmappedCount === 0 ? "" : " badge--warn"}`}
              title="Resources with no equivalent on the target provider"
            >
              {unmappedCount}
            </span>
          </div>
          {unmappedCount === 0 ? (
            <p className="help">Every resource mapped cleanly to the target provider. ✓</p>
          ) : (
            <ul className="finding-list">
              {result.unmapped.map((u) => (
                <li key={u.resourceId} className="finding finding--warn">
                  <button
                    type="button"
                    className="finding-msg text-left"
                    onClick={() => onSelectResource?.(u.resourceId)}
                    title={u.reason}
                  >
                    <span className="font-medium">{u.name || u.resourceId}</span>{" "}
                    <span className="text-xs opacity-70">({u.serviceId})</span>
                    <span className="block text-xs opacity-80">{u.reason}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};
