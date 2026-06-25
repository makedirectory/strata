/**
 * Strata CLI — the local Terraform/OpenTofu companion entrypoint.
 *
 * Run via `npm run strata -- <command>` (uses `npx tsx`, no build step, like the
 * MCP server). It drives the same pure engines + server runner the app uses:
 *
 *   strata roots   <dir>                       list a repo's Terraform roots
 *   strata connect <dir> [--root N] [--strategy auto|static|resolved]
 *   strata plan    <dir> [--root N]            run `plan` and diff it
 *   strata watch   <dir> [--root N]            re-plan on .tf change (until ^C)
 *
 * Flags: --json (print machine-readable output for CI/agents), --save (write a
 * snapshot to the storage folder, STRATA_DATA_DIR). Local-only.
 */
import { detectRepoRoots, connectRepo, type ConnectStrategy } from "../server/connectRepo";
import { runRepoPlan, type PlanResult } from "../server/runPlan";
import { watchRepoPlan } from "../server/watchPlan";
import { saveSnapshot } from "../server/strataStore";

interface Flags {
  root?: string;
  strategy?: ConnectStrategy;
  json: boolean;
  save: boolean;
  dir?: string;
}

function parse(argv: string[]): Flags {
  const f: Flags = { json: false, save: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") f.json = true;
    else if (a === "--save") f.save = true;
    else if (a === "--root") f.root = argv[++i];
    else if (a === "--strategy") f.strategy = argv[++i] as ConnectStrategy;
    else if (!a.startsWith("--") && !f.dir) f.dir = a;
  }
  return f;
}

const USAGE = `strata — local Terraform/OpenTofu companion

Usage:
  npm run strata -- roots   <dir>
  npm run strata -- connect <dir> [--root NAME] [--strategy auto|static|resolved] [--json] [--save]
  npm run strata -- plan    <dir> [--root NAME] [--json] [--save]
  npm run strata -- watch   <dir> [--root NAME] [--save]

Notes:
  connect  builds a layered diagram from the repo (no cloud credentials).
  plan     runs \`terraform plan\` in your repo (your backend + credentials) and
           diffs it; writes the plan file to a temp dir, never applies.
  watch    re-runs plan whenever .tf/.tfvars change, printing each diff until ^C.
  --save   writes a snapshot to STRATA_DATA_DIR (default ~/.strata).`;

function die(msg: string): never {
  process.stderr.write(msg + "\n");
  process.exit(1);
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  const flags = parse(rest);

  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
    process.stdout.write(USAGE + "\n");
    return;
  }
  if (!flags.dir) die(`Missing <dir>.\n\n${USAGE}`);
  const dir = flags.dir;

  if (cmd === "roots") {
    const roots = await detectRepoRoots(dir);
    if (flags.json) process.stdout.write(JSON.stringify({ roots }, null, 2) + "\n");
    else process.stdout.write(roots.map((r) => `${r.name}\t${r.dir}`).join("\n") + "\n");
    return;
  }

  if (cmd === "connect") {
    const r = await connectRepo(dir, {
      roots: flags.root ? [flags.root] : undefined,
      strategy: flags.strategy,
    });
    if (flags.save) {
      const meta = await saveSnapshot({ name: `${dir} connect`, graph: r.graph, repo: dir });
      r.warnings.push(`Saved snapshot ${meta.id}.`);
    }
    if (flags.json) {
      process.stdout.write(JSON.stringify(r, null, 2) + "\n");
    } else {
      process.stdout.write(
        [
          `Connected ${r.roots.length} root(s), ${r.graph.resources.length} resource(s).`,
          ...r.roots.map((x) => `  ${x.name}: ${x.resourceCount} (${x.strategy})`),
          ...r.warnings.map((w) => `  ! ${w}`),
        ].join("\n") + "\n",
      );
    }
    return;
  }

  if (cmd === "plan") {
    const r = await runRepoPlan(dir, { root: flags.root });
    if (flags.save) {
      const meta = await saveSnapshot({
        name: `${r.root ?? dir} plan`,
        graph: r.graph,
        diff: r.diff,
        repo: dir,
        root: r.root,
      });
      r.warnings.push(`Saved snapshot ${meta.id}.`);
    }
    if (flags.json) {
      process.stdout.write(JSON.stringify(r, null, 2) + "\n");
    } else {
      const c = r.diff.counts;
      process.stdout.write(
        [
          `Plan for ${r.root ?? dir}: ${r.graph.resources.length} resource(s).`,
          `  +${c.create} create  ~${c.update} update  ±${c.replace} replace  -${c.delete} delete`,
          ...r.warnings.map((w) => `  ! ${w}`),
        ].join("\n") + "\n",
      );
    }
    return;
  }

  if (cmd === "watch") {
    const stamp = () => new Date().toLocaleTimeString();
    const summarise = async (r: PlanResult) => {
      const c = r.diff.counts;
      process.stdout.write(
        `[${stamp()}] ${r.root ?? dir}: +${c.create} ~${c.update} ±${c.replace} -${c.delete}` +
          (c.create + c.update + c.replace + c.delete === 0 ? "  (no changes)" : "") +
          "\n",
      );
      for (const w of r.warnings) process.stdout.write(`  ! ${w}\n`);
      if (flags.save) {
        const meta = await saveSnapshot({
          name: `${r.root ?? dir} plan`,
          graph: r.graph,
          diff: r.diff,
          repo: dir,
          root: r.root,
        });
        process.stdout.write(`  saved snapshot ${meta.id}\n`);
      }
    };

    const controller = new AbortController();
    process.stdout.write(`Watching ${dir}${flags.root ? ` (${flags.root})` : ""} — ^C to stop.\n`);
    await watchRepoPlan(dir, {
      root: flags.root,
      onStatus: (phase) => {
        if (phase === "planning") process.stdout.write(`[${stamp()}] re-planning…\n`);
      },
      onUpdate: (r) => void summarise(r),
      onError: (e) => process.stderr.write(`[${stamp()}] error: ${e.message}\n`),
      signal: controller.signal,
    });
    process.on("SIGINT", () => {
      controller.abort();
      process.stdout.write("\nStopped.\n");
      process.exit(0);
    });
    // Keep the event loop alive until ^C.
    await new Promise<void>(() => {});
    return;
  }

  die(`Unknown command: ${cmd}\n\n${USAGE}`);
}

main().catch((e) => die(e instanceof Error ? e.message : String(e)));
