import { describe, it, expect, beforeEach, vi } from "vitest";
import { recordInterest, hasRegisteredInterest } from "./interest";

describe("interest", () => {
  beforeEach(() => localStorage.clear());

  it("records interest idempotently and reports it", () => {
    expect(hasRegisteredInterest("cost-optimization")).toBe(false);
    expect(recordInterest("cost-optimization")).toBe(true); // newly registered
    expect(hasRegisteredInterest("cost-optimization")).toBe(true);
    expect(recordInterest("cost-optimization")).toBe(false); // already known
  });

  it("dispatches a strata:interest window event with the feature", () => {
    const seen: string[] = [];
    const handler = (e: Event) => seen.push((e as CustomEvent).detail.feature);
    window.addEventListener("strata:interest", handler);
    recordInterest("drift-detection", "note");
    window.removeEventListener("strata:interest", handler);
    expect(seen).toEqual(["drift-detection"]);
  });

  it("POSTs to /api/interest only on a hosted deployment", () => {
    const fetchSpy = vi.fn((..._args: unknown[]) =>
      Promise.resolve(new Response(null, { status: 204 })),
    );
    vi.stubGlobal("fetch", fetchSpy);

    // Not hosted → no network call (nothing to collect on a local box).
    recordInterest("cost-optimization");
    expect(fetchSpy).not.toHaveBeenCalled();

    // Hosted → fire-and-forget POST to the same-origin route.
    localStorage.clear();
    vi.stubEnv("NEXT_PUBLIC_STRATA_HOSTED", "1");
    recordInterest("cost-optimization", "yes please");
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/interest",
      expect.objectContaining({ method: "POST" }),
    );

    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
});
