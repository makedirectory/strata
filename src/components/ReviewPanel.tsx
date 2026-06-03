"use client";
import React from "react";
import type { AccountReview, ReviewFinding } from "../aws/review";
import { formatMonthly } from "../aws/cost";

/**
 * Explain & Clean — account review panel (presentation only).
 *
 * Renders the output of `reviewAccount(graph)`: a cost-map summary, the scored
 * risk findings, and the safe-cleanup checklist. Pure and props-driven — it
 * imports only its engine types + React and has NO store/context coupling, so
 * the integrator can mount it anywhere (right sidebar section or a floating
 * canvas overlay) and feed it a derived `review` value. Uses the existing CSS
 * class vocabulary (inspector/section/badge/finding-msg…) plus light Tailwind
 * utilities so it sits consistently next to Inspector/DriftPanel.
 */
export interface ReviewPanelProps {
  review: AccountReview;
  /** Optional click handler so a host can focus/select a finding's resource. */
  onSelectResource?: (resourceId: string) => void;
}

const LEVEL_LABEL: Record<ReviewFinding["level"], string> = {
  error: "error",
  warn: "warn",
  info: "info",
};

function pct(coverage: number): string {
  return `${Math.round(coverage * 100)}%`;
}

export const ReviewPanel: React.FC<ReviewPanelProps> = ({ review, onSelectResource }) => {
  const { tagCoverage } = review;
  return (
    <div className="inspector review-panel">
      {/* ---- cost map summary ---- */}
      <div className="section">
        <div className="ins-panel-head">
          <strong>Account review</strong>
          <span className="badge" title="Sum of per-finding scores (error=3, warn=1)">
            risk {review.riskScore}
          </span>
        </div>
        <div className="kv">
          <span>Resources</span>
          <span>{review.resourceCount}</span>
        </div>
        <div className="kv">
          <span>Est. monthly</span>
          <span>{formatMonthly(review.estimatedMonthly)}</span>
        </div>
        <div className="kv">
          <span>Priced / unknown</span>
          <span>
            {review.estimatedCount} / {review.unknownCount}
          </span>
        </div>
        <div className="kv">
          <span>Tag coverage</span>
          <span>
            {pct(tagCoverage.coverage)}{" "}
            <span className="text-xs opacity-70">
              ({tagCoverage.tagged} tagged, {tagCoverage.untagged} untagged)
            </span>
          </span>
        </div>
      </div>

      {/* ---- risk findings ---- */}
      <div className="section">
        <div className="ins-panel-head">
          <strong>Findings</strong>
          <span className="badge">{review.findings.length}</span>
        </div>
        <div className="ins-results">
          {review.findings.length === 0 ? (
            <span className="no-issues">No findings.</span>
          ) : (
            review.findings.map((f) => (
              <div
                key={f.id}
                className={`mt-1 flex items-start gap-2 ${
                  f.resourceId && onSelectResource ? "cursor-pointer" : ""
                }`}
                onClick={
                  f.resourceId && onSelectResource
                    ? () => onSelectResource(f.resourceId as string)
                    : undefined
                }
              >
                <span className={`badge badge-${f.level}`} title={f.category}>
                  {LEVEL_LABEL[f.level]}
                </span>
                <span className="finding-msg">{f.message}</span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ---- safe-cleanup checklist ---- */}
      <div className="section">
        <div className="ins-panel-head">
          <strong>Safe cleanup</strong>
          <span className="badge">{review.cleanup.length}</span>
        </div>
        <div className="ins-results">
          {review.cleanup.length === 0 ? (
            <span className="no-suggestions">Nothing to clean up.</span>
          ) : (
            review.cleanup.map((c) => (
              <div
                key={c.resourceId}
                className={`mt-1 flex items-start justify-between gap-2 ${
                  onSelectResource ? "cursor-pointer" : ""
                }`}
                onClick={onSelectResource ? () => onSelectResource(c.resourceId) : undefined}
              >
                <span className="finding-msg">
                  <strong>{c.name}</strong> — {c.reason}
                </span>
                <span className="badge" title="Reclaimable monthly spend">
                  {formatMonthly(c.monthlyCost)}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
