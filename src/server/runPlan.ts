/**
 * Terraform/OpenTofu plan → graph + diff (server-only).
 * -----------------------------------------------------
 * The companion's core: visualise what a `plan` will change.
 *
 * A meaningful diff needs the **real backend state** — without it terraform
 * reports every resource as a create. So there is deliberately *no* throwaway
 * copy / `-backend=false` here. Two honest paths:
 *
 *   - `importPlanJson(json)` — pure-ish: ingest a plan JSON the user already
 *     produced (`terraform show -json plan.bin`). **No credentials, no exec.**
 *     This is the safe, universal primary path (the API uses it).
 *   - `runRepoPlan(repoPath, …)` — local convenience (CLI): run `plan` in the
 *     user's *own* repo with their ambient creds/backend, capture the JSON, and
 *     diff it. The plan file is written to a temp dir (never the repo); we never
 *     `apply`.
 */
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { importTerraform } from "../aws/iac";
import { planDiff, type PlanDiff } from "../aws/planDiff";
import { detectTfRoots } from "../aws/tfRepo";
import { MERGED_TF_TYPE_TO_SERVICE_ID, MERGED_CONTAINMENT_KEYS } from "../lib/importIac";
import type { InfrastructureGraph } from "../aws/model";
import {
  collectTfFiles,
  exec,
  findBinary,
  parseFiles,
  resolveRepoPath,
  TF_ENV,
  varFileArgs,
} from "./repoFs";

const TF_OPTS = { typeMap: MERGED_TF_TYPE_TO_SERVICE_ID, containmentKeys: MERGED_CONTAINMENT_KEYS };

export interface PlanResult {
  graph: InfrastructureGraph;
  diff: PlanDiff;
  /** Root that was planned (empty string = repo root), when known. */
  root?: string;
  warnings: string[];
}

/**
 * Build a graph + change diff from a `terraform show -json <plan>` document.
 * Pure-ish (no exec / creds). `json` may be the parsed object or a JSON string.
 */
export function importPlanJson(json: unknown, name = "Terraform plan"): PlanResult {
  const doc = typeof json === "string" ? (JSON.parse(json) as unknown) : json;
  const { graph } = importTerraform(doc, name, TF_OPTS);
  return { graph, diff: planDiff(doc), warnings: [] };
}

/**
 * Run `terraform/tofu plan` in the user's own repo (a local, opt-in convenience)
 * and diff the result. Uses the repo's real backend + ambient credentials so the
 * diff reflects actual drift; writes the plan file to a temp dir, never applies.
 */
export async function runRepoPlan(
  repoPath: string,
  opts: { root?: string } = {},
): Promise<PlanResult> {
  const repoRoot = await resolveRepoPath(repoPath);
  const bin = await findBinary();
  if (!bin) throw new Error("No terraform/tofu binary found on PATH.");

  // Pick the root to plan: the requested one, or the sole root, else ask.
  const parsed = await parseFiles(await collectTfFiles(repoRoot), []);
  const roots = detectTfRoots(parsed);
  const root = opts.root
    ? roots.find((r) => r.name === opts.root)
    : roots.length === 1
      ? roots[0]
      : undefined;
  if (!root) {
    throw new Error(
      opts.root
        ? `Root "${opts.root}" not found.`
        : `This repo has ${roots.length} roots (${roots.map((r) => r.name).join(", ")}). Pass --root.`,
    );
  }

  const cwd = join(repoRoot, root.dir);
  const planDir = await mkdtemp(join(tmpdir(), "strata-plan-"));
  const planFile = join(planDir, "strata.tfplan");
  try {
    const vars = await varFileArgs(cwd);
    await exec(bin, ["plan", "-input=false", "-no-color", `-out=${planFile}`, ...vars], {
      cwd,
      env: TF_ENV,
      timeout: 300_000,
    });
    const { stdout } = await exec(bin, ["show", "-json", planFile], {
      cwd,
      env: TF_ENV,
      timeout: 60_000,
      maxBuffer: 64 * 1024 * 1024,
    });
    return { ...importPlanJson(stdout, `${root.name} plan`), root: root.name };
  } finally {
    await rm(planDir, { recursive: true, force: true }).catch(() => {});
  }
}
