/**
 * Repository → graph connector (server-only; the one impure piece).
 * -----------------------------------------------------------------
 * Turns a Terraform/OpenTofu repo on disk into a Strata graph by running a
 * **strategy ladder** per root and normalising everything to the JSON the pure
 * importers already consume:
 *
 *   A. resolved (richest) — if `terraform`/`tofu` is on PATH, run
 *      `init -backend=false` → `plan -refresh=false` → `show -json` so modules,
 *      `for_each`/`count` and references are fully expanded. Uses **no cloud
 *      credentials** (`-backend=false`, `-refresh=false`) and runs against a
 *      throwaway **copy** of the repo so the source tree is never mutated.
 *   B. static (default workhorse) — convert raw `.tf` with `@cdktf/hcl2json` and
 *      resolve structure ourselves. Fully offline; no binary, creds or network.
 *
 * `strategy: "auto"` (default) tries A and falls back to B per root, reporting
 * which ran. This file owns all fs/`child_process` access; the graph logic lives
 * in the pure `aws/hclJson`, `aws/tfRepo` and `aws/iac` modules.
 */
import { execFile } from "node:child_process";
import { cp, mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { promisify } from "node:util";
import { parse as hcl2json } from "@cdktf/hcl2json";
import { importTerraform, type IacImportResult } from "../aws/iac";
import { importHclJson, type HclFile } from "../aws/hclJson";
import { detectTfRoots, mergeRootsAsLayers, type RootGraph, type TfRoot } from "../aws/tfRepo";
import { MERGED_TF_TYPE_TO_SERVICE_ID, MERGED_CONTAINMENT_KEYS } from "../lib/importIac";
import type { InfrastructureGraph } from "../aws/model";

const exec = promisify(execFile);

/** Directories never worth walking when collecting `.tf` files. */
const SKIP_DIRS = new Set([".git", ".terraform", "node_modules", ".next", "dist", "build", "out"]);

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

/** True when this instance is a shared/hosted deploy (no local fs/shell access). */
function isHosted(): boolean {
  const v = process.env.NEXT_PUBLIC_STRATA_HOSTED;
  return v === "1" || v === "true";
}

/** Reject paths that escape the repo root (defence-in-depth against traversal). */
function assertWithin(repoRoot: string, abs: string): void {
  const rel = relative(repoRoot, abs);
  if (rel.startsWith("..") || rel.startsWith(`..${sep}`)) {
    throw new Error("Refusing to read outside the repository root.");
  }
}

/** Recursively collect `.tf` files under `dir`, returning {abs, rel} pairs. */
async function collectTfFiles(
  repoRoot: string,
  dir: string,
  out: { abs: string; rel: string }[] = [],
): Promise<{ abs: string; rel: string }[]> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await collectTfFiles(repoRoot, join(dir, entry.name), out);
    } else if (entry.isFile() && entry.name.endsWith(".tf")) {
      const abs = join(dir, entry.name);
      assertWithin(repoRoot, abs);
      out.push({ abs, rel: relative(repoRoot, abs).split(sep).join("/") });
    }
  }
  return out;
}

/** Parse every collected file to an hcl2json doc, skipping (and noting) failures. */
async function parseFiles(
  files: { abs: string; rel: string }[],
  warnings: string[],
): Promise<HclFile[]> {
  const parsed: HclFile[] = [];
  for (const f of files) {
    try {
      const doc = await hcl2json(f.rel, await readFile(f.abs, "utf8"));
      parsed.push({ path: f.rel, doc: doc as Record<string, unknown> });
    } catch (e) {
      warnings.push(`Could not parse ${f.rel}: ${e instanceof Error ? e.message : "error"}.`);
    }
  }
  return parsed;
}

/** Validate the path and return its absolute form, or throw a friendly error. */
async function resolveRepoPath(repoPath: string): Promise<string> {
  if (isHosted()) {
    throw new Error(
      "Repository connect is unavailable on hosted deployments (needs local access).",
    );
  }
  if (!repoPath || typeof repoPath !== "string") throw new Error("A repository path is required.");
  let st;
  try {
    st = await stat(repoPath);
  } catch {
    throw new Error(`Path not found: ${repoPath}`);
  }
  if (!st.isDirectory()) throw new Error(`Not a directory: ${repoPath}`);
  return repoPath;
}

/** Enumerate the Terraform roots in a repo (cheap: parse + classify, no plan). */
export async function detectRepoRoots(repoPath: string): Promise<TfRoot[]> {
  const repoRoot = await resolveRepoPath(repoPath);
  const files = await collectTfFiles(repoRoot, repoRoot);
  const parsed = await parseFiles(files, []);
  return detectTfRoots(parsed);
}

/** Find an installed `terraform` or `tofu` binary, or `null`. */
async function findBinary(): Promise<string | null> {
  for (const bin of ["terraform", "tofu"]) {
    try {
      await exec(bin, ["version"], { timeout: 10_000 });
      return bin;
    } catch {
      /* not installed — try next */
    }
  }
  return null;
}

/**
 * Resolved strategy for one root, run inside `workDir` (a copy of the repo so
 * the source is never mutated). Returns the import result, or throws to signal
 * the caller to fall back to static.
 */
async function runResolved(bin: string, workDir: string, root: TfRoot): Promise<IacImportResult> {
  const cwd = join(workDir, root.dir);
  // Relocate provider plugins into the copy's tree; never touch real state.
  const env = { ...process.env, TF_IN_AUTOMATION: "1", TF_INPUT: "0" };
  await exec(bin, ["init", "-backend=false", "-input=false", "-no-color"], {
    cwd,
    env,
    timeout: 240_000,
  });
  // Auto-load any *.tfvars present so plan can resolve required variables.
  const varFiles = (await readdir(cwd))
    .filter((f) => f.endsWith(".tfvars") || f.endsWith(".tfvars.json"))
    .flatMap((f) => ["-var-file", f]);
  await exec(
    bin,
    ["plan", "-refresh=false", "-input=false", "-no-color", "-out=strata.tfplan", ...varFiles],
    { cwd, env, timeout: 180_000 },
  );
  const { stdout } = await exec(bin, ["show", "-json", "strata.tfplan"], {
    cwd,
    env,
    timeout: 60_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  return importTerraform(JSON.parse(stdout), root.name, TF_OPTS);
}

/**
 * Connect a Terraform repository and return a single layered graph (one Account
 * layer per selected root). Never mutates the source repo; never uses cloud
 * credentials.
 */
export async function connectRepo(
  repoPath: string,
  opts: ConnectRepoOptions = {},
): Promise<ConnectRepoResult> {
  const repoRoot = await resolveRepoPath(repoPath);
  const strategy = opts.strategy ?? "auto";
  const warnings: string[] = [];

  const files = await collectTfFiles(repoRoot, repoRoot);
  if (files.length === 0) throw new Error("No .tf files found under that path.");
  const parsed = await parseFiles(files, warnings);

  const allRoots = detectTfRoots(parsed);
  if (allRoots.length === 0) throw new Error("No Terraform root modules detected.");
  const selected = opts.roots?.length
    ? allRoots.filter((r) => opts.roots!.includes(r.name))
    : allRoots;
  if (selected.length === 0) throw new Error("None of the requested roots were found.");

  // Set up the throwaway copy only if the resolved strategy may be used.
  const bin = strategy === "static" ? null : await findBinary();
  let workDir: string | null = null;
  if (bin && strategy !== "static") {
    workDir = await mkdtemp(join(tmpdir(), "strata-tf-"));
    await cp(repoRoot, workDir, {
      recursive: true,
      filter: (src) => !src.split(sep).some((seg) => SKIP_DIRS.has(seg)),
    });
  }
  if (strategy === "resolved" && !bin) {
    throw new Error("Resolved strategy requested but no terraform/tofu binary was found.");
  }

  const reports: RootReport[] = [];
  const parts: RootGraph[] = [];
  const unmapped = new Set<string>();

  try {
    for (const root of selected) {
      let result: IacImportResult | null = null;
      let used: RootReport["strategy"] = "static";

      if (bin && workDir && strategy !== "static") {
        try {
          result = await runResolved(bin, workDir, root);
          used = "resolved";
        } catch (e) {
          if (strategy === "resolved") {
            reports.push({
              name: root.name,
              dir: root.dir,
              strategy: "failed",
              resourceCount: 0,
              note: e instanceof Error ? e.message.split("\n")[0] : "resolved plan failed",
            });
            continue;
          }
          warnings.push(
            `Root "${root.name}": resolved plan failed (${e instanceof Error ? e.message.split("\n")[0] : "error"}); used static parse.`,
          );
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

  const repoName = repoRoot.split(sep).filter(Boolean).pop() || "repository";
  const graph = mergeRootsAsLayers(parts, repoName);

  return { graph, roots: reports, unmappedTypes: [...unmapped], warnings };
}
