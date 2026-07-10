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
 *   strata cost    <file|dir>                  offline cost total + floor flag
 *   strata render  <graph.json> -o out.svg     lay out + write a standalone SVG
 *
 * Flags: --json (print machine-readable output for CI/agents), --save (write a
 * snapshot to the storage folder, STRATA_DATA_DIR). Local-only.
 */
import { readFileSync, writeFileSync, statSync } from "node:fs";
import { detectRepoRoots, connectRepo, type ConnectStrategy } from "../server/connectRepo";
import { runRepoPlan, type PlanResult } from "../server/runPlan";
import { watchRepoPlan } from "../server/watchPlan";
import { saveSnapshot } from "../server/strataStore";
import type { InfrastructureGraph } from "../aws/model";
import { importAnyIaC } from "../lib/importIac";
import { formatMonthly, type CostAssumptions } from "../aws/cost";
import { buildCostReport, renderGraphSvg } from "./offline";

interface Flags {
  root?: string;
  strategy?: ConnectStrategy;
  json: boolean;
  save: boolean;
  dir?: string;
  out?: string;
  regionMultiplier?: number;
  hours?: number;
  discount?: number;
}

function parse(argv: string[]): Flags {
  const f: Flags = { json: false, save: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") f.json = true;
    else if (a === "--save") f.save = true;
    else if (a === "--root") f.root = argv[++i];
    else if (a === "--strategy") f.strategy = argv[++i] as ConnectStrategy;
    else if (a === "-o" || a === "--out") f.out = argv[++i];
    else if (a === "--region-multiplier") f.regionMultiplier = Number(argv[++i]);
    else if (a === "--hours") f.hours = Number(argv[++i]);
    else if (a === "--discount") f.discount = Number(argv[++i]);
    else if (!a.startsWith("--") && !f.dir) f.dir = a;
  }
  return f;
}

/** Build CostAssumptions from flags, omitting any that weren't provided. */
function assumptionsFromFlags(f: Flags): CostAssumptions | undefined {
  const a: CostAssumptions = {};
  if (Number.isFinite(f.regionMultiplier)) a.regionMultiplier = f.regionMultiplier;
  if (Number.isFinite(f.hours)) a.hoursPerMonth = f.hours;
  if (Number.isFinite(f.discount)) a.discountPct = f.discount;
  return Object.keys(a).length > 0 ? a : undefined;
}

/** Load a graph for `cost`: import a single IaC file, or connect a repo dir. */
async function loadGraphForCost(path: string): Promise<InfrastructureGraph> {
  if (statSync(path).isDirectory()) {
    return (await connectRepo(path, {})).graph;
  }
  return importAnyIaC(readFileSync(path, "utf8"), { name: path }).graph;
}

const USAGE = `strata — local Terraform/OpenTofu companion

Usage:
  npm run strata -- roots   <dir>
  npm run strata -- connect <dir> [--root NAME] [--strategy auto|static|resolved] [--json] [--save]
  npm run strata -- plan    <dir> [--root NAME] [--json] [--save]
  npm run strata -- watch   <dir> [--root NAME] [--save]
  npm run strata -- cost    <file|dir> [--region-multiplier N] [--hours N] [--discount PCT] [--json]
  npm run strata -- render  <graph.json> -o <out.svg> [--json]

Notes:
  connect  builds a layered diagram from the repo (no cloud credentials).
  plan     runs \`terraform plan\` in your repo (your backend + credentials) and
           diffs it; writes the plan file to a temp dir, never applies.
  watch    re-runs plan whenever .tf/.tfvars change, printing each diff until ^C.
  cost     imports an IaC file (or connects a repo dir) and prints a monthly
           total + per-category roll-up; flags the total as a FLOOR when any
           billable type is unpriced. Offline; no credentials beyond file read.
  render   lays out a saved InfrastructureGraph JSON and writes a standalone SVG.
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

  if (cmd === "cost") {
    const report = buildCostReport(await loadGraphForCost(dir), assumptionsFromFlags(flags));
    if (flags.json) {
      process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    } else {
      const lines: string[] = [];
      lines.push(
        `${report.resourceCount} resource(s): ${formatMonthly(report.total)}` +
          (report.isFloor ? "  (FLOOR — lower bound)" : ""),
      );
      for (const c of report.categories) {
        lines.push(
          `  ${c.category.padEnd(14)} ${formatMonthly(c.total).padStart(10)}  (${c.count})`,
        );
      }
      if (report.unknown > 0) {
        lines.push(`  ${report.unknown} unpriced resource(s) excluded from the total.`);
      }
      if (report.isFloor) {
        lines.push(
          "",
          `⚠ FLOOR: the total is a lower bound — ${report.unmappedBillableTypes.length} billable type(s) unmapped:`,
          `  ${report.unmappedBillableTypes.join(", ")}`,
        );
      }
      process.stdout.write(lines.join("\n") + "\n");
    }
    return;
  }

  if (cmd === "render") {
    if (!flags.out) die(`render requires -o <out.svg>.\n\n${USAGE}`);
    let graph: InfrastructureGraph;
    try {
      graph = JSON.parse(readFileSync(dir, "utf8")) as InfrastructureGraph;
    } catch (e) {
      die(`Could not read graph JSON at ${dir}: ${e instanceof Error ? e.message : String(e)}`);
    }
    const svg = renderGraphSvg(graph);
    writeFileSync(flags.out, svg);
    const nodes = Array.isArray(graph.resources) ? graph.resources.length : 0;
    if (flags.json) {
      process.stdout.write(
        JSON.stringify({ out: flags.out, nodes, bytes: svg.length }, null, 2) + "\n",
      );
    } else {
      process.stdout.write(`Wrote ${flags.out} — ${nodes} node(s), ${svg.length} bytes.\n`);
    }
    return;
  }

  die(`Unknown command: ${cmd}\n\n${USAGE}`);
}

main().catch((e) => die(e instanceof Error ? e.message : String(e)));
