/**
 * Lightweight "feature interest" signal — backend-free and analytics-ready.
 *
 * Used by "coming soon" prompts to gauge demand. Recording interest:
 *   1. stores the feature locally (so the UI can show a thank-you and not
 *      re-prompt the same person),
 *   2. dispatches a `strata:interest` window event (an integration point for
 *      whatever analytics layer is added later), and
 *   3. fire-and-forget POSTs to `NEXT_PUBLIC_STRATA_INTEREST_URL` when set — so
 *      a webhook/form endpoint can collect signals today, with zero infra.
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
  const url = process.env.NEXT_PUBLIC_STRATA_INTEREST_URL;
  if (url && typeof fetch === "function") {
    void fetch(url, {
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
