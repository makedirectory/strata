/**
 * Lightweight "feature interest" signal — backend-free and analytics-ready.
 *
 * Used by "coming soon" prompts to gauge demand. Recording interest:
 *   1. stores the feature locally (so the UI can show a thank-you and not
 *      re-prompt the same person),
 *   2. dispatches a `strata:interest` window event (an integration point for
 *      whatever analytics layer is added later), and
 *   3. **on a hosted deployment only** (`NEXT_PUBLIC_STRATA_HOSTED=1`),
 *      fire-and-forget POSTs the signal to the same-origin `/api/interest` route,
 *      which notifies the operator (webhook + log). There's nothing to collect on
 *      a single-user local box, so the network call is skipped there.
 */
const STORE_KEY = "strata.interest";

function readSet(): Set<string> {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const arr: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? (arr as string[]) : []);
  } catch {
    return new Set();
  }
}

/** Whether this browser has already registered interest in `feature`. */
export function hasRegisteredInterest(feature: string): boolean {
  return readSet().has(feature);
}

/** Record interest in a feature (idempotent per browser). Returns false if the
 *  feature was already registered locally. */
export function recordInterest(feature: string, note?: string): boolean {
  const set = readSet();
  const isNew = !set.has(feature);
  set.add(feature);
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify([...set]));
  } catch {
    /* private mode / storage disabled — the signal still fires below */
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("strata:interest", { detail: { feature, note } }));
  }
  // Notify the operator only on a hosted deployment, and only the first time a
  // browser registers (the UI doesn't re-prompt anyway). The server route
  // (`/api/interest`) decides how to deliver it (webhook + log).
  if (isNew && typeof fetch === "function" && process.env.NEXT_PUBLIC_STRATA_HOSTED === "1") {
    void fetch("/api/interest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ feature, note }),
      keepalive: true,
    }).catch(() => {
      /* best-effort; never block or surface a failure to the user */
    });
  }
  return isNew;
}
