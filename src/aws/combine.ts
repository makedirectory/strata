/**
 * Multi-graph combine — pure engine.
 * ----------------------------------
 * Fold several independently-imported graphs (e.g. one `terraform show -json`
 * per account/environment) into a single `InfrastructureGraph` for one canvas,
 * without hand-rolling id-prefixing, per-source wrappers or root coordinates.
 *
 * Note on naming: `merge.ts` already owns `mergeGraphs(base, incoming)`, the
 * two-graph UPSERT/reconcile used when re-scanning. This is a different
 * operation — an N-source union — so it lives here as `combineGraphs` (the MCP
 * tool that wraps it is still named `merge_graphs`).
 *
 * Guarantees:
 *  - **Id namespacing**: every resource id, relationship id, relationship
 *    endpoint and `parentId` is prefixed by a unique per-source slug, so ids
 *    from different sources can never collide.
 *  - **No cross-source leakage**: a `parentId` only ever points inside the same
 *    source (or that source's synthetic wrapper); relationships with an endpoint
 *    outside their source are dropped.
 *  - **Grid-ready placement**: the nodes that become top-level roots are left
 *    position-less on purpose, so `computeLayout`'s auto-grid (see
 *    `src/canvas/layout.ts`) spreads the sources out side-by-side instead of
 *    stacking them at the origin. This is the single, documented placement
 *    strategy — combine assigns no coordinates itself.
 *  - **Sidecars carried**: each resource's verbatim `raw` IaC source is preserved
 *    so export can still re-emit faithfully; the first source's `iacSource` is
 *    carried onto the combined graph.
 *
 * Pure: no DOM, network, or credentials — shared by the UI and the MCP server.
 */
import type { InfrastructureGraph, ResourceInstance, Relationship } from "./model";
import { emptyGraph } from "./model";

/** One named source graph to fold into the combine. */
export interface CombineSource {
  /** Human label for the source (account/environment) — also seeds its slug. */
  name: string;
  graph: InfrastructureGraph;
}

export interface CombineOptions {
  /**
   * When `"container"`, synthesize one container node per source and reparent
   * that source's roots under it, so each account/environment reads as a labeled
   * block. Omit to leave roots un-wrapped and rely on the layout grid.
   */
  wrapAs?: "container";
  /** Name for the combined graph (default "Combined Graph"). */
  name?: string;
}

/**
 * Existing container service reused to wrap a source under `wrapAs: "container"`
 * — an AWS Organizations node reads naturally as an account/zone boundary, and
 * being a registry container it nests its children in the layout.
 */
const WRAPPER_SERVICE_ID = "organizations";

/** Kebab-case a source name into an id-safe slug fragment. */
function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "source";
}

/**
 * A per-source id prefix. The `index` alone already guarantees uniqueness; the
 * slug makes ids readable and the `used` guard is belt-and-suspenders.
 */
function uniquePrefix(name: string, index: number, used: Set<string>): string {
  const base = `${slugify(name)}-${index}`;
  let prefix = base;
  let n = 1;
  while (used.has(prefix)) prefix = `${base}-${n++}`;
  used.add(prefix);
  return prefix;
}

/**
 * Combine `sources` into one graph. Each source is namespaced independently; the
 * combined graph's roots are position-less so the layout grid arranges them.
 */
export function combineGraphs(
  sources: CombineSource[],
  opts: CombineOptions = {},
): InfrastructureGraph {
  const wrap = opts.wrapAs === "container";
  const combined = emptyGraph(opts.name ?? "Combined Graph");
  const resources: ResourceInstance[] = [];
  const relationships: Relationship[] = [];
  const usedPrefixes = new Set<string>();

  sources.forEach((entry, index) => {
    const { name, graph } = entry;
    const prefix = uniquePrefix(name, index, usedPrefixes);
    const ns = (id: string): string => `${prefix}:${id}`;
    const localIds = new Set(graph.resources.map((r) => r.id));
    const wrapperId = ns("__source__");
    let wrapperUsed = false;

    for (const r of graph.resources) {
      // A valid in-source parent, else this node is a root within its source.
      const parentInSource =
        r.parentId && r.parentId !== r.id && localIds.has(r.parentId) ? r.parentId : undefined;
      const isRoot = parentInSource === undefined;
      const parentId = wrap && isRoot ? wrapperId : parentInSource ? ns(parentInSource) : undefined;
      if (wrap && isRoot) wrapperUsed = true;

      const next: ResourceInstance = { ...r, id: ns(r.id), parentId };
      // Strip position from the nodes that become top-level roots so the layout
      // grid spreads the sources out. When wrapping, the wrapper is the root and
      // former roots become its children (layout owns child placement anyway).
      if (!wrap && isRoot) delete next.position;
      resources.push(next);
    }

    if (wrap && wrapperUsed) {
      // Position-less on purpose → grid-packed by computeLayout.
      resources.push({
        id: wrapperId,
        serviceId: WRAPPER_SERVICE_ID,
        name,
        source: "mcp",
        config: {},
      });
    }

    for (const rel of graph.relationships) {
      // Endpoints must both exist in this source (no dangling / cross-source).
      if (!localIds.has(rel.from) || !localIds.has(rel.to)) continue;
      relationships.push({ ...rel, id: ns(rel.id), from: ns(rel.from), to: ns(rel.to) });
    }

    for (const acc of graph.accounts) combined.accounts.push({ ...acc, id: ns(acc.id) });
    if (!combined.iacSource && graph.iacSource) combined.iacSource = graph.iacSource;
  });

  combined.resources = resources;
  combined.relationships = relationships;
  return combined;
}
