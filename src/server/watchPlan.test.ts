// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createPlanScheduler } from "./watchPlan";
import type { PlanResult } from "./runPlan";

const fakeResult = (n: number): PlanResult => ({
  graph: { id: "", name: "g", schemaVersion: 1, accounts: [], resources: [], relationships: [] },
  diff: { changes: {}, counts: { create: n, update: 0, delete: 0, replace: 0, read: 0, noop: 0 } },
  warnings: [],
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("createPlanScheduler", () => {
  it("debounces a burst of notifications into a single run", async () => {
    const run = vi.fn().mockResolvedValue(fakeResult(1));
    const onUpdate = vi.fn();
    const s = createPlanScheduler({ run, onUpdate, onError: vi.fn(), debounceMs: 100 });

    s.notify();
    s.notify();
    s.notify();
    expect(run).not.toHaveBeenCalled(); // still within debounce window
    await vi.advanceTimersByTimeAsync(100);
    expect(run).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledTimes(1);
    s.dispose();
  });

  it("single-flights: a change during a run queues exactly one trailing run", async () => {
    let resolveFirst: (r: PlanResult) => void = () => {};
    const run = vi
      .fn()
      .mockImplementationOnce(() => new Promise<PlanResult>((res) => (resolveFirst = res)))
      .mockResolvedValue(fakeResult(2));
    const onUpdate = vi.fn();
    const s = createPlanScheduler({ run, onUpdate, onError: vi.fn(), debounceMs: 10 });

    s.trigger(); // first run starts, stays pending
    expect(run).toHaveBeenCalledTimes(1);
    s.notify(); // change arrives mid-run
    s.notify(); // ...coalesced
    await vi.advanceTimersByTimeAsync(10);
    expect(run).toHaveBeenCalledTimes(1); // still only the first; trailing is queued

    resolveFirst(fakeResult(1)); // finish first run → trailing run fires
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(2);
    expect(onUpdate).toHaveBeenCalledTimes(2);
    s.dispose();
  });

  it("reports run errors via onError and keeps going", async () => {
    const run = vi
      .fn()
      .mockRejectedValueOnce(new Error("plan boom"))
      .mockResolvedValue(fakeResult(1));
    const onError = vi.fn();
    const onUpdate = vi.fn();
    const s = createPlanScheduler({ run, onUpdate, onError, debounceMs: 10 });

    s.trigger();
    await vi.advanceTimersByTimeAsync(0);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "plan boom" }));

    s.notify();
    await vi.advanceTimersByTimeAsync(10);
    expect(onUpdate).toHaveBeenCalledTimes(1);
    s.dispose();
  });

  it("dispose stops pending work from emitting", async () => {
    const run = vi.fn().mockResolvedValue(fakeResult(1));
    const onUpdate = vi.fn();
    const s = createPlanScheduler({ run, onUpdate, onError: vi.fn(), debounceMs: 50 });
    s.notify();
    s.dispose();
    await vi.advanceTimersByTimeAsync(50);
    expect(run).not.toHaveBeenCalled();
  });
});
