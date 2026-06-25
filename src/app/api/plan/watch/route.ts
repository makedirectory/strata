/**
 * /api/plan/watch — live plan diff over Server-Sent Events.
 *   GET ?repoPath=…&root=… → an event stream:
 *     event: status  data: { phase: "planning" | "idle" }
 *     event: plan    data: { graph, diff, root, warnings }
 *     event: error   data: { message }
 *
 * The server watches the repo's .tf/.tfvars files and re-runs `terraform plan`
 * (debounced, single-flighted) on each change, pushing the result. Local-only:
 * uses the repo's backend + ambient credentials and runs nothing on a hosted
 * deployment. The watcher is torn down when the client disconnects.
 */
import { requireAuth } from "../../../../server/auth";
import { isHosted } from "../../../../server/repoFs";
import { watchRepoPlan } from "../../../../server/watchPlan";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = requireAuth(req);
  if (denied) return denied;

  const url = new URL(req.url);
  const repoPath = url.searchParams.get("repoPath")?.trim();
  const root = url.searchParams.get("root")?.trim() || undefined;

  const encoder = new TextEncoder();
  let cleanup: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          /* controller already closed */
        }
      };
      const close = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        cleanup?.();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      req.signal.addEventListener("abort", close, { once: true });

      if (!repoPath) {
        send("error", { message: "repoPath query parameter is required." });
        close();
        return;
      }
      if (isHosted()) {
        send("error", { message: "Watch is unavailable on hosted deployments (local only)." });
        close();
        return;
      }

      send("status", { phase: "planning" });
      heartbeat = setInterval(() => {
        if (!closed) controller.enqueue(encoder.encode(`: ping\n\n`));
      }, 15_000);

      cleanup = await watchRepoPlan(repoPath, {
        root,
        onUpdate: (result) => send("plan", result),
        onError: (err) => send("error", { message: err.message }),
        onStatus: (phase) => send("status", { phase }),
        signal: req.signal,
      });
    },
    cancel() {
      if (heartbeat) clearInterval(heartbeat);
      cleanup?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
