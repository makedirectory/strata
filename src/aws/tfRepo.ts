/**
 * Terraform repository topology helpers (pure).
 * ----------------------------------------------
 * A repo is not one Terraform configuration — it is many. Reusable `modules/`
 * are libraries; the real entry points are the **roots** (a.k.a. root modules):
 * directories you actually `terraform apply` in, each with its own backend /
 * provider config (e.g. `environments/prod`, `environments/stage`, `bootstrap`).
 *
 * `detectTfRoots` finds those entry points from a set of parsed `.tf` files, and
 * `mergeRootsAsLayers` stitches per-root graphs into one diagram with a distinct
 * `Account` layer per root (re-namespacing ids so identical module addresses
 * across roots don't collide).
 */
import { dirOf, resolveDir, type HclFile } from "./hclJson";
import { emptyGraph, type Account, type InfrastructureGraph } from "./model";

/** A Terraform root module (an apply-able entry point). */
export interface TfRoot {
  /** Repo-relative POSIX directory, e.g. `"environments/prod"`. */
  dir: string;
  /** Short, unique display name, e.g. `"prod"`. */
  name: string;
}

/** Distinct, stable-ish colours for root layers. */
const LAYER_COLORS = [
  "#2563eb",
  "#16a34a",
  "#db2777",
  "#d97706",
  "#7c3aed",
  "#0891b2",
  "#dc2626",
  "#4b5563",
];

function hasKey(files: HclFile[], dir: string, key: string): boolean {
  return files.some((f) => dirOf(f.path) === dir && key in f.doc);
}

/**
 * True when any `terraform {}` block in `dir` configures a `backend`. A bare
 * `terraform {}` (just `required_providers`/`required_version`) is common inside
 * reusable modules and must NOT mark them as roots — only a backend does.
 */
function declaresBackend(files: HclFile[], dir: string): boolean {
  return files.some((f) => {
    if (dirOf(f.path) !== dir) return false;
    const blocks = f.doc.terraform;
    const list = Array.isArray(blocks) ? blocks : blocks ? [blocks] : [];
    return list.some((b) => b && typeof b === "object" && "backend" in (b as object));
  });
}

/**
 * Identify the root modules in a repo. A directory is a root when it is an
 * apply-able entry point — it declares a `backend` or a `provider` block — or,
 * failing that, holds top-level `resource`/`module` blocks. In every case a dir
 * that is referenced as another dir's local module, or that sits under a
 * conventional `modules/` library path, is excluded (those are libraries, and a
 * module declaring its own `terraform { required_providers }` is not a root).
 */
export function detectTfRoots(files: HclFile[]): TfRoot[] {
  const dirs = new Set(files.map((f) => dirOf(f.path)));

  // Directories pulled in as local modules by some other directory — children,
  // never roots.
  const childDirs = new Set<string>();
  for (const f of files) {
    const mod = f.doc.module;
    if (mod && typeof mod === "object") {
      for (const instances of Object.values(mod as Record<string, unknown>)) {
        const first = Array.isArray(instances) ? instances[0] : instances;
        const source =
          first && typeof first === "object"
            ? (first as Record<string, unknown>).source
            : undefined;
        if (typeof source === "string" && source.startsWith(".")) {
          childDirs.add(resolveDir(dirOf(f.path), source));
        }
      }
    }
  }

  const isLibrary = (dir: string) => childDirs.has(dir) || dir.split("/").includes("modules");

  const roots: TfRoot[] = [];
  for (const dir of dirs) {
    if (isLibrary(dir)) continue; // reusable module, not an entry point
    const declaresEntry = declaresBackend(files, dir) || hasKey(files, dir, "provider");
    const declaresInfra = hasKey(files, dir, "resource") || hasKey(files, dir, "module");
    if (declaresEntry || declaresInfra) roots.push({ dir, name: leafName(dir) });
  }

  // Fallback: a flat repo with no provider blocks — treat any non-child infra
  // dir outside `modules/` as a root so the connector still has something.
  if (roots.length === 0) {
    for (const dir of dirs) {
      if (
        !childDirs.has(dir) &&
        !dir.split("/").includes("modules") &&
        (hasKey(files, dir, "resource") || hasKey(files, dir, "module"))
      ) {
        roots.push({ dir, name: leafName(dir) });
      }
    }
  }

  return disambiguate(roots).sort((a, b) => a.dir.localeCompare(b.dir));
}

/** Last path segment, with `.`/empty mapped to `"root"`. */
function leafName(dir: string): string {
  const leaf = dir.split("/").filter(Boolean).pop();
  return leaf || "root";
}

/** Qualify duplicate leaf names with their parent dir so each name is unique. */
function disambiguate(roots: TfRoot[]): TfRoot[] {
  const counts = new Map<string, number>();
  for (const r of roots) counts.set(r.name, (counts.get(r.name) ?? 0) + 1);
  return roots.map((r) => {
    if ((counts.get(r.name) ?? 0) <= 1) return r;
    const parts = r.dir.split("/").filter(Boolean);
    return { ...r, name: parts.slice(-2).join("/") || r.name };
  });
}

/** One root's contribution to a merged diagram. */
export interface RootGraph {
  root: TfRoot;
  graph: InfrastructureGraph;
}

/** Vertical gap between stacked root layers so they don't overlap on the canvas. */
const LAYER_BAND = 2000;

/**
 * Merge per-root graphs into a single diagram, one `Account` layer per root.
 * Resource ids are namespaced by root (`<root>::<address>`) so identical module
 * addresses across roots stay distinct, and each layer is offset vertically.
 */
export function mergeRootsAsLayers(parts: RootGraph[], name: string): InfrastructureGraph {
  const merged = emptyGraph(name);

  parts.forEach(({ root, graph }, index) => {
    const accountId = root.name;
    merged.accounts.push({
      id: accountId,
      accountId,
      name: root.name,
      environment: root.name,
      color: LAYER_COLORS[index % LAYER_COLORS.length],
    } satisfies Account);

    const nsId = (id: string) => `${accountId}::${id}`;
    const dy = index * LAYER_BAND;

    for (const r of graph.resources) {
      merged.resources.push({
        ...r,
        id: nsId(r.id),
        accountId,
        parentId: r.parentId ? nsId(r.parentId) : undefined,
        position: r.position ? { ...r.position, y: r.position.y + dy } : r.position,
      });
    }
    for (const e of graph.relationships) {
      merged.relationships.push({
        ...e,
        id: nsId(e.id),
        from: nsId(e.from),
        to: nsId(e.to),
      });
    }
  });

  return merged;
}
