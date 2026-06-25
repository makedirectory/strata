/**
 * Live plan watcher (server-only).
 * --------------------------------
 * Re-runs a Terraform/OpenTofu plan whenever the repo's `.tf`/`.tfvars` change,
 * and streams the result (graph + change diff) to a caller — the engine behind
 * `strata watch` and the `/api/plan/watch` SSE endpoint.
 *
 * The scheduling core (`createPlanScheduler`) is decoupled from fs + terraform so
 * it can be unit-tested with fakes. It guarantees:
 *   - **debounce**: a burst of saves coalesces into one run.
 *   - **single-flight**: never two plans at once; a change during a run queues
 *     exactly one trailing run.
 */
import { watch as fsWatch } from "node:fs";
import { runRepoPlan, type PlanResult } from "./runPlan";
import { collectTfFiles, parseFiles, resolveRepoPath, SKIP_DIRS } from "./repoFs";
import { detectTfRoots } from "../aws/tfRepo";

export type WatchPhase = "planning" | "idle";

export interface PlanSchedulerCallbacks {
  run: () => Promise<PlanResult>;
  onUpdate: (result: PlanResult) => void;
  onError: (err: Error) => void;
  onStatus?: (phase: WatchPhase) => void;
  debounceMs?: number;
}

export interface PlanScheduler {
  /** Signal that a relevant file changed (debounced + single-flighted). */
  notify: () => void;
  /** Run immediately (used for the initial plan); still single-flighted. */
  trigger: () => void;
  /** Cancel any pending debounce timer. */
  dispose: () => void;
}

/**
 * Debounce + single-flight scheduler. Pure of fs/terraform — `run` does the work.
 */
export function createPlanScheduler(cb: PlanSchedulerCallbacks): PlanScheduler {
  const debounceMs = cb.debounceMs ?? 400;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let pending = false;
  let disposed = false;

  const fire = async () => {
    if (disposed) return;
    if (running) {
      pending = true;
      return;
    }
    running = true;
    cb.onStatus?.("planning");
    try {
      const result = await cb.run();
      if (!disposed) cb.onUpdate(result);
    } catch (e) {
      if (!disposed) cb.onError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      running = false;
      cb.onStatus?.("idle");
      if (pending && !disposed) {
        pending = false;
        fire();
      }
    }
  };

  const notify = () => {
    if (disposed) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fire();
    }, debounceMs);
  };

  return {
    notify,
    trigger: fire,
    dispose: () => {
      disposed = true;
      if (timer) clearTimeout(timer);
    },
  };
}

export interface WatchRepoPlanOptions {
  root?: string;
  onUpdate: (result: PlanResult) => void;
  onError: (err: Error) => void;
  onStatus?: (phase: WatchPhase) => void;
  debounceMs?: number;
  signal?: AbortSignal;
}

/**
 * Watch a repo and re-plan on change. Resolves the root, runs an initial plan,
 * then re-plans (debounced) on `.tf`/`.tfvars` edits anywhere under the repo
 * (ignoring `.terraform`/`.git`/etc., so our own runs don't self-trigger).
 * Returns a cleanup function. All errors are reported via `onError` (never thrown).
 */
export async function watchRepoPlan(
  repoPath: string,
  opts: WatchRepoPlanOptions,
): Promise<() => void> {
  let repoRoot: string;
  let rootName: string | undefined = opts.root;
  try {
    repoRoot = await resolveRepoPath(repoPath);
    // Resolve which root we're planning so the initial run + status are concrete.
    if (!rootName) {
      const roots = detectTfRoots(await parseFiles(await collectTfFiles(repoRoot), []));
      if (roots.length === 1) rootName = roots[0].name;
      else if (roots.length > 1) {
        throw new Error(
          `This repo has ${roots.length} roots (${roots.map((r) => r.name).join(", ")}). Pass a root to watch.`,
        );
      }
    }
  } catch (e) {
    opts.onError(e instanceof Error ? e : new Error(String(e)));
    return () => {};
  }

  const scheduler = createPlanScheduler({
    run: () => runRepoPlan(repoRoot, { root: rootName }),
    onUpdate: opts.onUpdate,
    onError: opts.onError,
    onStatus: opts.onStatus,
    debounceMs: opts.debounceMs,
  });

  // Recursive watch over the whole repo so module edits (outside the root dir)
  // also trigger; filter to IaC files and skip generated/VCS dirs to avoid loops.
  let watcher: ReturnType<typeof fsWatch> | null = null;
  try {
    watcher = fsWatch(repoRoot, { recursive: true }, (_event, filename) => {
      if (!filename) return;
      const path = filename.toString();
      if (path.split(/[\\/]/).some((seg) => SKIP_DIRS.has(seg))) return;
      if (path.endsWith(".tf") || path.endsWith(".tfvars") || path.endsWith(".tfvars.json")) {
        scheduler.notify();
      }
    });
  } catch (e) {
    opts.onError(e instanceof Error ? e : new Error(String(e)));
  }

  const cleanup = () => {
    scheduler.dispose();
    watcher?.close();
  };
  if (opts.signal) {
    if (opts.signal.aborted) {
      cleanup();
      return () => {};
    }
    opts.signal.addEventListener("abort", cleanup, { once: true });
  }

  scheduler.trigger(); // initial plan
  return cleanup;
}
