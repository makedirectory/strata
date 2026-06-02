"use client";
import React from "react";
import { recordInterest, hasRegisteredInterest } from "../lib/interest";

/**
 * "Cost optimization — coming soon" prompt: a toolbar affordance + modal that
 * previews the planned feature and lets a user register interest (so we can
 * gauge demand before building it). Self-contained — owns its own open state.
 */
export const CostComingSoon: React.FC = () => {
  const [open, setOpen] = React.useState(false);
  const [registered, setRegistered] = React.useState(false);

  React.useEffect(() => {
    if (open) setRegistered(hasRegisteredInterest("cost-optimization"));
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        className="toolbar-soon"
        onClick={() => setOpen(true)}
        title="Advanced cost optimization (coming soon)"
        aria-label="Advanced cost optimization — coming soon"
      >
        ✦
      </button>
      {open && (
        <div className="hub-backdrop hub-backdrop--top" onMouseDown={() => setOpen(false)}>
          <div
            className="soon"
            role="dialog"
            aria-modal="true"
            aria-label="Cost optimization — coming soon"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <button className="hub-close" onClick={() => setOpen(false)} aria-label="Close">
              ✕
            </button>
            <div className="soon-badge">Coming soon</div>
            <h2 className="soon-title">Cost optimization</h2>
            <p className="soon-body">
              The current overlay is a rough, us-east-1 estimate. We&rsquo;re exploring deeper cost
              analysis:
            </p>
            <ul className="soon-list">
              <li>Region-aware, usage-based pricing (hours, storage, requests)</li>
              <li>Rightsizing &amp; idle-resource recommendations</li>
              <li>Reserved / savings-plan and commitment awareness</li>
              <li>Per-environment and per-account roll-ups</li>
            </ul>
            {registered ? (
              <p className="soon-thanks">Thanks — we&rsquo;ve noted your interest. ✓</p>
            ) : (
              <button
                className="btn-start"
                onClick={() => {
                  recordInterest("cost-optimization");
                  setRegistered(true);
                }}
              >
                I&rsquo;d use this — keep me posted
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
};
