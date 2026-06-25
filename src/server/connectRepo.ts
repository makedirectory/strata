/**
 * Repository → graph connector (server-only).
 * -------------------------------------------
 * Turns a local Terraform/OpenTofu repo into one layered Strata graph (an
 * Account layer per root), normalising everything to the JSON the pure importers
 * already consume via a **strategy ladder** per root:
 *
 *   A. resolved (richest) — if `terraform`/`tofu` is on PATH, run
 *      `init -backend=false` → `plan -refresh=false` → `show -json` so modules,
 *      `for_each`/`count` and references are fully expanded. Uses **no cloud
 *      credentials** and runs against a throwaway **copy** of the repo.
 *   B. static (default workhorse) — convert raw `.tf` with `@cdktf/hcl2json`.
 *
 * `strategy: "auto"` (default) tries A and falls back to B per root.
 */
import { join } from "node:path";
import { rm } from "node:fs/promises";
import { importTerraform, type IacImportResult } from "../aws/iac";
import { importHclJson } from "../aws/hclJson";
import { detectTfRoots, mergeRootsAsLayers, type RootGraph, type TfRoot } from "../aws/tfRepo";
import { MERGED_TF_TYPE_TO_SERVICE_ID, MERGED_CONTAINMENT_KEYS } from "../lib/importIac";
import type { InfrastructureGraph } from "../aws/model";
import {
  collectTfFiles,
  copyRepoToTemp,
  exec,
  findBinary,
  parseFiles,
  resolveRepoPath,
  TF_ENV,
  varFileArgs,
} from "./repoFs";

const TF_OPTS = { typeMap: MERGED_TF_TYPE_TO_SERVICE_ID, containmentKeys: MERGED_CONTAINMENT_KEYS };

export type ConnectStrategy = "auto" | "static" | "resolved";

export interface ConnectRepoOptions {
  /** Root names to include (from `detectRepoRoots`); default = all roots. */
  roots?: string[];
  /** Fidelity strategy per root; default `"auto"`. */
  strategy?: ConnectStrategy;
}

/** Per-root outcome surfaced to the caller. */
export interface RootReport {
  name: string;
  dir: string;
  strategy: "resolved" | "static" | "failed";
  resourceCount: number;
  note?: string;
}

export interface ConnectRepoResult {
  graph: InfrastructureGraph;
  roots: RootReport[];
  unmappedTypes: string[];
  warnings: string[];
}

/** Enumerate the Terraform roots in a repo (cheap: parse + classify, no plan). */
export async function detectRepoRoots(repoPath: string): Promise<TfRoot[]> {
  const repoRoot = await resolveRepoPath(repoPath);
  const files = await collectTfFiles(repoRoot);
  const parsed = await parseFiles(files, []);
  return detectTfRoots(parsed);
}

/** Resolved strategy for one root, run inside `workDir` (a throwaway repo copy). */
async function runResolved(bin: string, workDir: string, root: TfRoot): Promise<IacImportResult> {
  const cwd = join(workDir, root.dir);
  await exec(bin, ["init", "-backend=false", "-input=false", "-no-color"], {
    cwd,
    env: TF_ENV,
    timeout: 240_000,
  });
  const vars = await varFileArgs(cwd);
  await exec(
    bin,
    ["plan", "-refresh=false", "-input=false", "-no-color", "-out=strata.tfplan", ...vars],
    { cwd, env: TF_ENV, timeout: 180_000 },
  );
  const { stdout } = await exec(bin, ["show", "-json", "strata.tfplan"], {
    cwd,
    env: TF_ENV,
    timeout: 60_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  return importTerraform(JSON.parse(stdout), root.name, TF_OPTS);
}

/**
 * Connect a Terraform repository and return a single layered graph. Never
 * mutates the source repo; never uses cloud credentials.
 */
export async function connectRepo(
  repoPath: string,
  opts: ConnectRepoOptions = {},
): Promise<ConnectRepoResult> {
  const repoRoot = await resolveRepoPath(repoPath);
  const strategy = opts.strategy ?? "auto";
  const warnings: string[] = [];

  const files = await collectTfFiles(repoRoot);
  if (files.length === 0) throw new Error("No .tf files found under that path.");
  const parsed = await parseFiles(files, warnings);

  const allRoots = detectTfRoots(parsed);
  if (allRoots.length === 0) throw new Error("No Terraform root modules detected.");
  const selected = opts.roots?.length
    ? allRoots.filter((r) => opts.roots!.includes(r.name))
    : allRoots;
  if (selected.length === 0) throw new Error("None of the requested roots were found.");

  const bin = strategy === "static" ? null : await findBinary();
  if (strategy === "resolved" && !bin) {
    throw new Error("Resolved strategy requested but no terraform/tofu binary was found.");
  }
  const workDir = bin ? await copyRepoToTemp(repoRoot) : null;

  const reports: RootReport[] = [];
  const parts: RootGraph[] = [];
  const unmapped = new Set<string>();

  try {
    for (const root of selected) {
      let result: IacImportResult | null = null;
      let used: RootReport["strategy"] = "static";

      if (bin && workDir) {
        try {
          result = await runResolved(bin, workDir, root);
          used = "resolved";
        } catch (e) {
          const msg = e instanceof Error ? e.message.split("\n")[0] : "resolved plan failed";
          if (strategy === "resolved") {
            reports.push({
              name: root.name,
              dir: root.dir,
              strategy: "failed",
              resourceCount: 0,
              note: msg,
            });
            continue;
          }
          warnings.push(`Root "${root.name}": resolved plan failed (${msg}); used static parse.`);
        }
      }

      if (!result) {
        result = importHclJson(parsed, root.dir, root.name, TF_OPTS);
        used = "static";
      }

      for (const t of result.unmappedTypes) unmapped.add(t);
      for (const w of result.warnings) warnings.push(`Root "${root.name}": ${w}`);
      parts.push({ root, graph: result.graph });
      reports.push({
        name: root.name,
        dir: root.dir,
        strategy: used,
        resourceCount: result.graph.resources.length,
      });
    }
  } finally {
    if (workDir) await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }

  const repoName = repoRoot.split(/[\\/]/).filter(Boolean).pop() || "repository";
  const graph = mergeRootsAsLayers(parts, repoName);
  return { graph, roots: reports, unmappedTypes: [...unmapped], warnings };
}
