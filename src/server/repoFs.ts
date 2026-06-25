/**
 * Shared server-only filesystem + terraform helpers for the IaC companion.
 * ------------------------------------------------------------------------
 * The repo connector (`connectRepo.ts`) and the plan runner (`runPlan.ts`) both
 * need to: validate a local path, collect/parse `.tf` files, find a
 * terraform/tofu binary, and run terraform against a **throwaway copy** of the
 * repo so the source tree is never mutated. Those primitives live here.
 *
 * Server-only (uses `node:fs`/`node:child_process`). Never uses cloud
 * credentials; never writes into the source repo.
 */
import { execFile } from "node:child_process";
import { cp, mkdtemp, readdir, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { parse as hcl2json } from "@cdktf/hcl2json";
import type { HclFile } from "../aws/hclJson";

export const exec = promisify(execFile);

/** Directories never worth walking/copying when handling a repo. */
export const SKIP_DIRS = new Set([
  ".git",
  ".terraform",
  "node_modules",
  ".next",
  "dist",
  "build",
  "out",
]);

/** True when this instance is a shared/hosted deploy (no local fs/shell access). */
export function isHosted(): boolean {
  const v = process.env.NEXT_PUBLIC_STRATA_HOSTED;
  return v === "1" || v === "true";
}

/** Reject paths that escape the repo root (defence-in-depth against traversal). */
export function assertWithin(repoRoot: string, abs: string): void {
  const rel = relative(repoRoot, abs);
  if (rel.startsWith("..") || rel.startsWith(`..${sep}`)) {
    throw new Error("Refusing to read outside the repository root.");
  }
}

/** Validate the path and return it, or throw a friendly error. Hosted = refused. */
export async function resolveRepoPath(repoPath: string): Promise<string> {
  if (isHosted()) {
    throw new Error(
      "Repository features are unavailable on hosted deployments (they need local access).",
    );
  }
  if (!repoPath || typeof repoPath !== "string") throw new Error("A repository path is required.");
  // Reject NUL-byte injection, then normalise to a single absolute path that all
  // downstream fs access derives from. (This is a local, single-user devtool —
  // reading the operator's chosen repo is the intended function — and it is fully
  // disabled on hosted/multi-tenant deploys by the guard above.)
  if (repoPath.includes("\0")) throw new Error("Invalid repository path.");
  const abs = resolve(repoPath);
  let st;
  try {
    st = await stat(abs);
  } catch {
    throw new Error(`Path not found: ${repoPath}`);
  }
  if (!st.isDirectory()) throw new Error(`Not a directory: ${repoPath}`);
  return abs;
}

/** Recursively collect `.tf` files under `dir`, returning {abs, rel} pairs. */
export async function collectTfFiles(
  repoRoot: string,
  dir: string = repoRoot,
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
export async function parseFiles(
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

/** Find an installed `terraform` or `tofu` binary, or `null`. */
export async function findBinary(): Promise<string | null> {
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

/** Copy a repo (minus heavy/ignored dirs) into a fresh temp dir; returns its path. */
export async function copyRepoToTemp(repoRoot: string): Promise<string> {
  const dest = await mkdtemp(join(tmpdir(), "strata-tf-"));
  await cp(repoRoot, dest, {
    recursive: true,
    filter: (src) => !src.split(sep).some((seg) => SKIP_DIRS.has(seg)),
  });
  return dest;
}

/** `-var-file` args for any `*.tfvars` present in `cwd` (best-effort plan inputs). */
export async function varFileArgs(cwd: string): Promise<string[]> {
  const entries = await readdir(cwd).catch(() => [] as string[]);
  return entries
    .filter((f) => f.endsWith(".tfvars") || f.endsWith(".tfvars.json"))
    .flatMap((f) => ["-var-file", f]);
}

/** Env that keeps terraform non-interactive and quiet. */
export const TF_ENV = { ...process.env, TF_IN_AUTOMATION: "1", TF_INPUT: "0" };
