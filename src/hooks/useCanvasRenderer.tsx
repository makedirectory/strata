"use client";
import { useCallback, useEffect, useRef } from "react";
import type { ResourceInstance, Relationship } from "../aws/model";
import type { RelationshipKind } from "../aws/types";
import type { Selection, Pan, CanvasDensity, LodTier } from "../types";
import { getService, serviceColor, serviceIcon } from "../aws/registry";
import { RELATIONSHIPS } from "../aws/categories";
import { relationshipClassDef } from "../aws/relationshipClasses";
import { regionName } from "../aws/regions";
import {
  boundsOf,
  unionRect,
  viewportWorldRect,
  minimapTransform,
  worldToMinimap,
  lodTier,
  rectsIntersect,
  type Rect,
} from "../canvas/geometry";
import type { LayoutResult } from "../canvas/layout";

/** Render up to N config entries (and region) as short key:value pill strings. */
function configPills(r: ResourceInstance): string[] {
  const svc = getService(r.serviceId);
  const pills: string[] = [];
  if (r.region) pills.push(regionName(r.region));
  if (svc) {
    for (const f of svc.configFields) {
      if (pills.length >= 3) break;
      const v = r.config[f.key];
      if (v === undefined || v === null || v === "") continue;
      let text: string;
      if (Array.isArray(v)) text = v.join(",");
      else if (typeof v === "boolean") text = v ? "yes" : "no";
      else text = String(v);
      if (text.length > 22) text = text.slice(0, 21) + "…";
      pills.push(`${f.label}: ${text}`);
    }
  }
  return pills.slice(0, 3);
}

/** Live handles for a node's DOM so per-draw diffing can update in place. */
interface NodeRecord {
  div: HTMLDivElement;
  icon: HTMLSpanElement;
  title: HTMLDivElement;
  titles: HTMLDivElement;
  subtitle: HTMLDivElement | null;
  body: HTMLDivElement;
  /** Container header extras (created lazily when a node renders as a container). */
  count: HTMLSpanElement | null;
  collapse: HTMLSpanElement | null;
  cleanups: Array<() => void>;
  /** Last-rendered primitive props, to skip no-op DOM writes. */
  prev: {
    x: number;
    y: number;
    w: number;
    /** Last-applied rendered height (from the layout engine). */
    h: number;
    color: string;
    name: string;
    icon: string;
    typeName: string;
    pills: string;
    selected: boolean;
    /** Effective LOD tier last applied (the lod-* class). */
    tier: string;
    compact: boolean;
    dimmed: boolean;
    container: boolean;
    count: number;
    collapsed: boolean;
    depth: number;
    envTint: string;
    searchMatch: boolean;
  };
}

/** Live handles for a relationship's path + label so it can be updated in place. */
interface EdgeRecord {
  path: SVGPathElement;
  label: SVGTextElement;
  cleanups: Array<() => void>;
  prev: {
    d: string;
    dash: string;
    color: string;
    labelText: string;
    midx: number;
    midy: number;
    selected: boolean;
    dimmed: boolean;
  };
}

/** Snapshot of the inputs that affect structure, used to detect viewport-only redraws. */
interface DrawInputs {
  resources: ResourceInstance[];
  relationships: Relationship[];
  selection: Selection;
  selectedIds: string[];
  density: CanvasDensity;
  /** Effective LOD tier for non-focused nodes (derived from the zoom scale). */
  tier: LodTier;
  /** Node to keep at full detail + its 1-hop neighbourhood lit (hover/selection). */
  focusId: string | null;
  /** Effective rects + nesting from the containment layout engine. */
  layout: LayoutResult;
  /** Container ids whose children are hidden (drives the collapse chevron). */
  collapsed: ReadonlySet<string>;
  /** When focusing a container, the id set of its subtree; others dim. */
  focusSubtree: ReadonlySet<string> | null;
  /** Layer filters: hidden resource categories + relationship classes. */
  hiddenCategories: ReadonlySet<string>;
  hiddenRelClasses: ReadonlySet<string>;
  /** Filtered-out elements dim (keep context) or hide entirely. */
  filterMode: "dim" | "hide";
  /** Environment-tint overlay: resource id → tint colour, or null when off. */
  envTintById: ReadonlyMap<string, string> | null;
  /** When set (large graphs), only render nodes/edges intersecting this world
   *  rect; null keeps the small-graph viewport-only fast path. */
  cullViewport: Rect | null;
  /** Edge routing style. */
  edgeStyle: "curved" | "orthogonal";
  /** Nodes matching the active search query (highlighted). */
  searchMatches: ReadonlySet<string>;
  onNodeMouseDown: (e: React.MouseEvent, r: ResourceInstance) => void;
  onConnect: (id: string, type: "start" | "end") => void;
  onSelect: (sel: Selection) => void;
  onHover: (id: string | null) => void;
  onToggleCollapse: (id: string) => void;
  /** Expand a summarized leaf group (parent container id + service id). */
  onExpandGroup: (parentId: string, serviceId: string) => void;
}

/** Live DOM handle for a "N× service" summary node. */
interface SummaryRecord {
  div: HTMLDivElement;
  cleanups: Array<() => void>;
  prev: {
    x: number;
    y: number;
    w: number;
    h: number;
    text: string;
    depth: number;
    dimmed: boolean;
  };
}

export function useCanvasRenderer(
  worldRef: React.RefObject<HTMLDivElement | null>,
  svgRef: React.RefObject<SVGSVGElement | null>,
  minimapRef: React.RefObject<HTMLCanvasElement | null>,
) {
  /** Persistent DOM caches, keyed by resource/relationship id, across draws. */
  const nodesRef = useRef<Map<string, NodeRecord>>(new Map());
  const edgesRef = useRef<Map<string, EdgeRecord>>(new Map());
  const summaryNodesRef = useRef<Map<string, SummaryRecord>>(new Map());

  /** Pending rAF id for coalescing structural redraws, plus the latest args. */
  const rafRef = useRef<number | null>(null);
  const pendingRef = useRef<DrawInputs | null>(null);

  /** Last inputs we structurally rendered, used to detect viewport-only changes. */
  const lastInputsRef = useRef<DrawInputs | null>(null);

  /**
   * Performs the actual structural diff/patch render. Only invoked from inside a
   * requestAnimationFrame tick (see `draw`), so multiple draw() calls within one
   * frame coalesce into a single DOM reconciliation pass.
   */
  const renderStructure = useCallback(
    (input: DrawInputs) => {
      const world = worldRef.current;
      const svg = svgRef.current;
      if (!world || !svg) return;

      const {
        resources,
        relationships,
        selection,
        selectedIds,
        density,
        tier,
        focusId,
        layout,
        collapsed,
        focusSubtree,
        hiddenCategories,
        hiddenRelClasses,
        filterMode,
        envTintById,
        cullViewport,
        edgeStyle,
        searchMatches,
        onNodeMouseDown,
        onConnect,
        onSelect,
        onHover,
        onToggleCollapse,
        onExpandGroup,
      } = input;
      const rectOf = layout.rects;

      // Resource ids whose category is filtered off (dim or hide).
      const categoryHidden = new Set<string>();
      if (hiddenCategories.size > 0) {
        for (const r of resources) {
          const cat = getService(r.serviceId)?.category;
          if (cat && hiddenCategories.has(cat)) categoryHidden.add(r.id);
        }
      }

      // Shared arrowhead marker (created once). `context-stroke` makes the head
      // inherit each edge's per-class stroke colour.
      if (!svg.querySelector("#edge-arrow")) {
        const NS = "http://www.w3.org/2000/svg";
        const defs = document.createElementNS(NS, "defs");
        const marker = document.createElementNS(NS, "marker");
        marker.setAttribute("id", "edge-arrow");
        marker.setAttribute("viewBox", "0 0 10 10");
        marker.setAttribute("refX", "9");
        marker.setAttribute("refY", "5");
        marker.setAttribute("markerWidth", "7");
        marker.setAttribute("markerHeight", "7");
        marker.setAttribute("orient", "auto-start-reverse");
        const tip = document.createElementNS(NS, "path");
        tip.setAttribute("d", "M0,0 L10,5 L0,10 z");
        tip.setAttribute("fill", "context-stroke");
        marker.appendChild(tip);
        defs.appendChild(marker);
        svg.appendChild(defs);
      }

      const nodes = nodesRef.current;
      const seenNodes = new Set<string>();
      // O(1) membership for the multi-selection outline.
      const selectedSet = new Set(selectedIds);

      // O(1) endpoint lookups for edges (was O(E*R) resources.find()).
      const byId = new Map<string, ResourceInstance>();
      for (const r of resources) byId.set(r.id, r);

      // Focus dimming: when a node is focused (hover/selection), keep it and its
      // 1-hop neighbours lit; everything else is dimmed.
      const focusNeighbours = new Set<string>();
      if (focusId) {
        focusNeighbours.add(focusId);
        for (const rel of relationships) {
          if (rel.from === focusId) focusNeighbours.add(rel.to);
          else if (rel.to === focusId) focusNeighbours.add(rel.from);
        }
      }

      resources.forEach((r) => {
        try {
          // Hidden inside a collapsed container → not rendered (the cleanup loop
          // removes any stale DOM since it is absent from seenNodes).
          const p = rectOf.get(r.id);
          if (!p) return;
          // Viewport culling: off-screen nodes get no DOM (removed via cleanup).
          if (cullViewport && !rectsIntersect(p, cullViewport)) return;
          const nodeFilteredOut = categoryHidden.has(r.id);
          // In "hide" mode a filtered node is removed (absent from seenNodes).
          if (nodeFilteredOut && filterMode === "hide") return;
          seenNodes.add(r.id);
          const isContainerNode = layout.isContainerNode(r.id);
          const childCount = layout.childCount(r.id);
          const nodeCollapsed = collapsed.has(r.id);
          const depthVal = layout.depth.get(r.id) ?? 0;
          const color = serviceColor(r.serviceId);
          const svc = getService(r.serviceId);
          const iconText = serviceIcon(r.serviceId);
          const typeNameRaw = svc?.name ?? r.serviceId;
          // Only show the service type when it differs from the node name —
          // otherwise it's redundant (e.g. an unrenamed "CloudFormation" node).
          const typeName = typeNameRaw && typeNameRaw !== r.name ? typeNameRaw : "";
          const pills = configPills(r);
          const pillsKey = pills.join(" ");
          // A node is outlined when it is the single selection OR a member of
          // the multi-selection (marquee/group).
          const selected =
            selectedSet.has(r.id) || (selection?.type === "node" && selection.id === r.id);
          // LOD: a focused (hovered/selected) node always renders at full detail;
          // others follow the zoom-derived tier. Box geometry comes from layout.
          const effTier: LodTier = r.id === focusId ? "near" : tier;
          const compact = density === "compact";
          // Dim if outside the hover 1-hop neighbourhood OR outside a focused
          // container's subtree.
          const hoverDim = focusId !== null && !focusNeighbours.has(r.id);
          const containerDim = focusSubtree !== null && !focusSubtree.has(r.id);
          const dimmed = hoverDim || containerDim || (nodeFilteredOut && filterMode === "dim");
          const envTint = envTintById?.get(r.id) ?? "";
          const searchMatch = searchMatches.has(r.id);

          let rec = nodes.get(r.id);
          if (!rec) {
            // ---- create (only for genuinely new nodes) ----
            const div = document.createElement("div");
            div.className = "node";
            div.dataset.id = r.id;

            const header = document.createElement("div");
            header.className = "node-header";

            const left = document.createElement("div");
            left.className = "node-headline";
            const icon = document.createElement("span");
            icon.className = "node-icon";

            const titles = document.createElement("div");
            titles.className = "node-titles";
            const title = document.createElement("div");
            title.className = "node-title";
            titles.appendChild(title);
            left.appendChild(icon);
            left.appendChild(titles);

            const right = document.createElement("div");
            right.className = "ports";

            const pOut = document.createElement("span");
            pOut.className = "port port-out";
            pOut.title = "Start connection";
            const pIn = document.createElement("span");
            pIn.className = "port port-in";
            pIn.title = "Finish connection";
            right.appendChild(pOut);
            right.appendChild(pIn);

            header.appendChild(left);
            header.appendChild(right);
            div.appendChild(header);

            const body = document.createElement("div");
            body.className = "node-body";
            div.appendChild(body);

            world.appendChild(div);

            rec = {
              div,
              icon,
              title,
              titles,
              subtitle: null,
              body,
              count: null,
              collapse: null,
              cleanups: [],
              prev: {
                x: NaN,
                y: NaN,
                w: NaN,
                h: NaN,
                color: "",
                name: "",
                icon: "",
                typeName: "",
                pills: "",
                selected: false,
                tier: "",
                compact: false,
                dimmed: false,
                container: false,
                count: -1,
                collapsed: false,
                depth: -1,
                envTint: "",
                searchMatch: false,
              },
            };
            nodes.set(r.id, rec);
          }

          const prev = rec.prev;

          // ---- detach + reattach listeners (closures capture the latest r and
          // callbacks, which change every draw) ----
          for (const c of rec.cleanups) c();
          rec.cleanups = [];

          const pOut = rec.div.querySelector<HTMLSpanElement>(".port-out")!;
          const pIn = rec.div.querySelector<HTMLSpanElement>(".port-in")!;
          const onPortOut = (e: MouseEvent) => {
            e.stopPropagation();
            onConnect(r.id, "start");
          };
          pOut.addEventListener("mousedown", onPortOut);
          rec.cleanups.push(() => pOut.removeEventListener("mousedown", onPortOut));

          const onPortIn = (e: MouseEvent) => {
            e.stopPropagation();
            onConnect(r.id, "end");
          };
          pIn.addEventListener("mousedown", onPortIn);
          rec.cleanups.push(() => pIn.removeEventListener("mousedown", onPortIn));

          const onNodeDown = (e: MouseEvent) => {
            if ((e.target as HTMLElement).closest(".port")) return;
            // The imperative handler shares the same shape as React's synthetic
            // event for the fields the consumer reads (clientX/Y, button,
            // preventDefault, stopPropagation), so the cast is safe here.
            // Selection is decided inside onNodeMouseDown (group vs single).
            onNodeMouseDown(e as unknown as React.MouseEvent, r);
          };
          rec.div.addEventListener("mousedown", onNodeDown);
          rec.cleanups.push(() => rec!.div.removeEventListener("mousedown", onNodeDown));

          // Hover drives focus-dimming (lights the node + its 1-hop neighbours).
          const onEnter = () => onHover(r.id);
          const onLeave = () => onHover(null);
          rec.div.addEventListener("mouseenter", onEnter);
          rec.div.addEventListener("mouseleave", onLeave);
          rec.cleanups.push(() => rec!.div.removeEventListener("mouseenter", onEnter));
          rec.cleanups.push(() => rec!.div.removeEventListener("mouseleave", onLeave));

          // ---- patch only changed visual props (geometry from the layout) ----
          if (p.x !== prev.x) rec.div.style.left = p.x + "px";
          if (p.y !== prev.y) rec.div.style.top = p.y + "px";
          if (p.w !== prev.w) rec.div.style.width = p.w + "px";
          if (p.h !== prev.h) rec.div.style.height = p.h + "px";
          // Deeper nodes stack above their containers.
          if (depthVal !== prev.depth) rec.div.style.zIndex = String(depthVal);
          // LOD tier + density + focus dimming via CSS classes.
          if (effTier !== prev.tier) {
            if (prev.tier) rec.div.classList.remove(`lod-${prev.tier}`);
            rec.div.classList.add(`lod-${effTier}`);
          }
          if (compact !== prev.compact) rec.div.classList.toggle("dense-compact", compact);
          if (dimmed !== prev.dimmed) rec.div.classList.toggle("dimmed", dimmed);
          if (searchMatch !== prev.searchMatch)
            rec.div.classList.toggle("search-match", searchMatch);
          // Environment-tint overlay (background tint by account environment).
          if (envTint !== prev.envTint) {
            if (envTint) {
              rec.div.style.setProperty("--env-tint", envTint);
              rec.div.classList.add("env-tinted");
            } else {
              rec.div.classList.remove("env-tinted");
              rec.div.style.removeProperty("--env-tint");
            }
          }

          // ---- container chrome (backplate header + child-count + collapse) ----
          if (isContainerNode !== prev.container) {
            rec.div.classList.toggle("container", isContainerNode);
          }
          if (isContainerNode) {
            // Lazily create the child-count badge + collapse chevron in the header.
            if (!rec.count) {
              const badge = document.createElement("span");
              badge.className = "node-count";
              rec.div.querySelector(".ports")?.before(badge);
              rec.count = badge;
            }
            if (!rec.collapse) {
              const chevron = document.createElement("span");
              chevron.className = "node-collapse";
              rec.div.querySelector(".ports")?.before(chevron);
              rec.collapse = chevron;
            }
            if (childCount !== prev.count) rec.count.textContent = String(childCount);
            if (nodeCollapsed !== prev.collapsed)
              rec.collapse.textContent = nodeCollapsed ? "▸" : "▾";
            // Rebind the chevron toggle (stops the press from starting a drag).
            const chevron = rec.collapse;
            const onChevron = (e: MouseEvent) => {
              e.stopPropagation();
              e.preventDefault();
              onToggleCollapse(r.id);
            };
            chevron.addEventListener("mousedown", onChevron);
            rec.cleanups.push(() => chevron.removeEventListener("mousedown", onChevron));
          } else {
            if (rec.count) {
              rec.count.remove();
              rec.count = null;
            }
            if (rec.collapse) {
              rec.collapse.remove();
              rec.collapse = null;
            }
          }
          if (color !== prev.color) rec.div.style.setProperty("--accent-color", color);
          if (iconText !== prev.icon) rec.icon.textContent = iconText;
          if (r.name !== prev.name) {
            rec.title.textContent = r.name;
            rec.title.title = r.name; // native tooltip when the name is truncated
          }
          if (typeName !== prev.typeName || color !== prev.color) {
            if (typeName) {
              if (!rec.subtitle) {
                const subtitle = document.createElement("div");
                subtitle.className = "node-subtitle";
                rec.subtitle = subtitle;
                rec.titles.appendChild(subtitle);
              }
              rec.subtitle.textContent = typeName;
              rec.subtitle.style.color = color;
            } else if (rec.subtitle) {
              rec.subtitle.remove();
              rec.subtitle = null;
            }
          }
          if (pillsKey !== prev.pills) {
            rec.body.textContent = "";
            for (const text of pills) {
              const pill = document.createElement("span");
              pill.className = "pill";
              pill.textContent = text;
              rec.body.appendChild(pill);
            }
          }
          if (selected !== prev.selected) {
            // Use outline (not borderColor) so the category-colour left-accent
            // stripe set via --accent-color is preserved when unselected.
            rec.div.style.outline = selected ? "2px solid #5fbef3" : "";
            rec.div.style.outlineOffset = selected ? "1px" : "";
            rec.div.style.boxShadow = selected
              ? "0 4px 14px rgba(76,167,255,.35)"
              : "0 2px 10px rgba(0,0,0,.35)";
          }

          prev.x = p.x;
          prev.y = p.y;
          prev.w = p.w;
          prev.h = p.h;
          prev.color = color;
          prev.name = r.name;
          prev.icon = iconText;
          prev.typeName = typeName;
          prev.pills = pillsKey;
          prev.selected = selected;
          prev.tier = effTier;
          prev.compact = compact;
          prev.dimmed = dimmed;
          prev.container = isContainerNode;
          prev.count = childCount;
          prev.collapsed = nodeCollapsed;
          prev.depth = depthVal;
          prev.envTint = envTint;
          prev.searchMatch = searchMatch;
        } catch (err) {
          console.error("draw node failed", r, err);
        }
      });

      // ---- remove nodes that no longer exist (detach their listeners) ----
      for (const [id, rec] of nodes) {
        if (seenNodes.has(id)) continue;
        for (const c of rec.cleanups) c();
        rec.div.remove();
        nodes.delete(id);
      }

      // ---- summary nodes ("N× service", click to expand) ----
      const summaryNodes = summaryNodesRef.current;
      const seenSummaries = new Set<string>();
      for (const s of layout.summaries) {
        const rect = rectOf.get(s.id);
        if (!rect) continue;
        if (cullViewport && !rectsIntersect(rect, cullViewport)) continue;
        const cat = getService(s.serviceId)?.category;
        const filteredOut = cat ? hiddenCategories.has(cat) : false;
        if (filteredOut && filterMode === "hide") continue;
        seenSummaries.add(s.id);

        const svc = getService(s.serviceId);
        const text = `${s.count}× ${svc?.name ?? s.serviceId}`;
        const depthVal = layout.depth.get(s.id) ?? 0;
        const dimmed =
          (filteredOut && filterMode === "dim") ||
          (focusSubtree !== null && !focusSubtree.has(s.parentId));

        let rec = summaryNodes.get(s.id);
        if (!rec) {
          const div = document.createElement("div");
          div.className = "node summary";
          const icon = document.createElement("span");
          icon.className = "node-icon";
          const label = document.createElement("div");
          label.className = "node-title";
          div.appendChild(icon);
          div.appendChild(label);
          world.appendChild(div);
          rec = {
            div,
            cleanups: [],
            prev: { x: NaN, y: NaN, w: NaN, h: NaN, text: "", depth: -1, dimmed: false },
          };
          summaryNodes.set(s.id, rec);
        }
        const icon = rec.div.querySelector<HTMLSpanElement>(".node-icon")!;
        icon.textContent = serviceIcon(s.serviceId);
        rec.div.style.setProperty("--accent-color", serviceColor(s.serviceId));

        const prev = rec.prev;
        if (rect.x !== prev.x) rec.div.style.left = rect.x + "px";
        if (rect.y !== prev.y) rec.div.style.top = rect.y + "px";
        if (rect.w !== prev.w) rec.div.style.width = rect.w + "px";
        if (rect.h !== prev.h) rec.div.style.height = rect.h + "px";
        if (depthVal !== prev.depth) rec.div.style.zIndex = String(depthVal);
        if (text !== prev.text) rec.div.querySelector(".node-title")!.textContent = text;
        if (dimmed !== prev.dimmed) rec.div.classList.toggle("dimmed", dimmed);

        for (const c of rec.cleanups) c();
        rec.cleanups = [];
        const onClick = (e: MouseEvent) => {
          e.stopPropagation();
          onExpandGroup(s.parentId, s.serviceId);
        };
        rec.div.addEventListener("mousedown", onClick);
        rec.cleanups.push(() => rec!.div.removeEventListener("mousedown", onClick));

        prev.x = rect.x;
        prev.y = rect.y;
        prev.w = rect.w;
        prev.h = rect.h;
        prev.text = text;
        prev.depth = depthVal;
        prev.dimmed = dimmed;
      }
      for (const [id, rec] of summaryNodes) {
        if (seenSummaries.has(id)) continue;
        for (const c of rec.cleanups) c();
        rec.div.remove();
        summaryNodes.delete(id);
      }

      // ---- edges ----
      const edges = edgesRef.current;
      const seenEdges = new Set<string>();

      relationships.forEach((rel) => {
        const a = byId.get(rel.from);
        const b = byId.get(rel.to);
        if (!a || !b) return;
        // Reroute endpoints hidden inside a collapsed container to the visible
        // ancestor that represents them; drop edges fully internal to one.
        const fromId = rectOf.has(rel.from) ? rel.from : layout.visibleAncestor.get(rel.from);
        const toId = rectOf.has(rel.to) ? rel.to : layout.visibleAncestor.get(rel.to);
        if (!fromId || !toId || fromId === toId) return;
        const ra = rectOf.get(fromId);
        const rb = rectOf.get(toId);
        if (!ra || !rb) return;
        // Layer filter: by relationship class or by either endpoint's category.
        const cls = relationshipClassDef(rel.kind as RelationshipKind);
        const edgeFilteredOut =
          hiddenRelClasses.has(cls.id) || categoryHidden.has(fromId) || categoryHidden.has(toId);
        if (edgeFilteredOut && filterMode === "hide") return;
        // Cull edges whose endpoints' span doesn't touch the viewport.
        if (cullViewport && !rectsIntersect(unionRect(ra, rb), cullViewport)) return;
        seenEdges.add(rel.id);

        const p1 = { x: ra.x + ra.w, y: ra.y + ra.h / 2 };
        const p2 = { x: rb.x, y: rb.y + rb.h / 2 };
        const dx = Math.max(40, Math.abs(p2.x - p1.x) / 2);
        const d =
          edgeStyle === "orthogonal"
            ? // Manhattan elbow: out horizontally, across, in horizontally.
              `M ${p1.x} ${p1.y} L ${(p1.x + p2.x) / 2} ${p1.y} L ${(p1.x + p2.x) / 2} ${p2.y} L ${p2.x} ${p2.y}`
            : `M ${p1.x} ${p1.y} C ${p1.x + dx} ${p1.y}, ${p2.x - dx} ${p2.y}, ${p2.x} ${p2.y}`;

        const def = RELATIONSHIPS[rel.kind as RelationshipKind];
        // Encode by relationship class: colour + dash (arrowhead via marker).
        const dash = cls.dash ?? "";
        const labelText = def?.label ?? rel.kind;
        const midx = (p1.x + p2.x) / 2;
        const midy = (p1.y + p2.y) / 2;
        const selected = selection?.type === "edge" && selection.id === rel.id;
        const color = selected ? "#5fbef3" : cls.color;
        // Dim unless the edge touches the hover focus / lies within a focused
        // container's subtree, or is filtered out by a layer.
        const hoverDim = focusId !== null && fromId !== focusId && toId !== focusId;
        const containerDim =
          focusSubtree !== null && (!focusSubtree.has(fromId) || !focusSubtree.has(toId));
        const dimmed = hoverDim || containerDim || (edgeFilteredOut && filterMode === "dim");

        let rec = edges.get(rel.id);
        if (!rec) {
          const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
          path.style.pointerEvents = "stroke";
          path.setAttribute("class", "edge");
          path.setAttribute("data-id", rel.id);
          // Directional arrowhead; `context-stroke` makes it match the edge's
          // (per-class) stroke colour.
          path.setAttribute("marker-end", "url(#edge-arrow)");
          const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
          label.setAttribute("text-anchor", "middle");
          label.setAttribute("font-size", "10");
          label.setAttribute("fill", "#cfe7ff");
          svg.appendChild(path);
          svg.appendChild(label);
          rec = {
            path,
            label,
            cleanups: [],
            prev: {
              d: "",
              dash: "",
              color: "",
              labelText: "",
              midx: NaN,
              midy: NaN,
              selected: false,
              dimmed: false,
            },
          };
          edges.set(rel.id, rec);
        }

        const prev = rec.prev;

        // Re-bind click handler (captures latest rel + endpoint names).
        for (const c of rec.cleanups) c();
        rec.cleanups = [];
        const onEdgeClick = (e: MouseEvent) => {
          e.stopPropagation();
          onSelect({
            type: "edge",
            id: rel.id,
            relationship: rel,
            fromName: a.name,
            toName: b.name,
          });
        };
        rec.path.addEventListener("click", onEdgeClick);
        rec.cleanups.push(() => rec!.path.removeEventListener("click", onEdgeClick));

        if (d !== prev.d) rec.path.setAttribute("d", d);
        if (dash !== prev.dash) {
          if (dash) rec.path.setAttribute("stroke-dasharray", dash);
          else rec.path.removeAttribute("stroke-dasharray");
        }
        // Stroke colour carries the relationship class (or the selection blue).
        if (color !== prev.color) rec.path.setAttribute("stroke", color);
        if (midx !== prev.midx) rec.label.setAttribute("x", String(midx));
        if (midy !== prev.midy) rec.label.setAttribute("y", String(midy - 6));
        if (labelText !== prev.labelText) rec.label.textContent = labelText;
        if (selected !== prev.selected) {
          rec.path.setAttribute("stroke-width", selected ? "3" : "2");
        }
        if (dimmed !== prev.dimmed) {
          rec.path.classList.toggle("dimmed", dimmed);
          rec.label.classList.toggle("dimmed", dimmed);
        }

        prev.d = d;
        prev.dash = dash;
        prev.color = color;
        prev.labelText = labelText;
        prev.midx = midx;
        prev.midy = midy;
        prev.selected = selected;
        prev.dimmed = dimmed;
      });

      // ---- remove edges that no longer exist ----
      for (const [id, rec] of edges) {
        if (seenEdges.has(id)) continue;
        for (const c of rec.cleanups) c();
        rec.path.remove();
        rec.label.remove();
        edges.delete(id);
      }

      lastInputsRef.current = input;
    },
    [worldRef, svgRef],
  );

  const draw = useCallback(
    (
      resources: ResourceInstance[],
      relationships: Relationship[],
      pan: Pan,
      selection: Selection,
      selectedIds: string[],
      density: CanvasDensity,
      focusId: string | null,
      layout: LayoutResult,
      collapsed: ReadonlySet<string>,
      focusSubtree: ReadonlySet<string> | null,
      hiddenCategories: ReadonlySet<string>,
      hiddenRelClasses: ReadonlySet<string>,
      filterMode: "dim" | "hide",
      envTintById: ReadonlyMap<string, string> | null,
      cullViewport: Rect | null,
      edgeStyle: "curved" | "orthogonal",
      searchMatches: ReadonlySet<string>,
      onNodeMouseDown: (e: React.MouseEvent, r: ResourceInstance) => void,
      onConnect: (id: string, type: "start" | "end") => void,
      onSelect: (sel: Selection) => void,
      onHover: (id: string | null) => void,
      onToggleCollapse: (id: string) => void,
      onExpandGroup: (parentId: string, serviceId: string) => void,
    ) => {
      const world = worldRef.current;
      const svg = svgRef.current;
      if (!world || !svg) return;

      // Viewport transform is always cheap; apply it synchronously every call so
      // pan/zoom feels immediate.
      const transform = `translate(${pan.x}px, ${pan.y}px) scale(${pan.scale})`;
      world.style.transform = transform;
      svg.style.transform = transform;

      // LOD tier from the effective zoom. Folding it into the inputs below means
      // a pure pan keeps the viewport-only fast path, while crossing a tier
      // boundary (or toggling density/focus) triggers one structural pass.
      const tier = lodTier(pan.scale);

      const input: DrawInputs = {
        resources,
        relationships,
        selection,
        selectedIds,
        density,
        tier,
        focusId,
        layout,
        collapsed,
        focusSubtree,
        hiddenCategories,
        hiddenRelClasses,
        filterMode,
        envTintById,
        cullViewport,
        edgeStyle,
        searchMatches,
        onNodeMouseDown,
        onConnect,
        onSelect,
        onHover,
        onToggleCollapse,
        onExpandGroup,
      };

      // Finding 2: if only the viewport changed (same tier), the transform above
      // is all that's needed — skip the structural diff entirely.
      const last = lastInputsRef.current;
      if (
        last &&
        last.resources === resources &&
        last.relationships === relationships &&
        last.selection === selection &&
        last.selectedIds === selectedIds &&
        last.density === density &&
        last.tier === tier &&
        last.focusId === focusId &&
        last.layout === layout &&
        last.collapsed === collapsed &&
        last.focusSubtree === focusSubtree &&
        last.hiddenCategories === hiddenCategories &&
        last.hiddenRelClasses === hiddenRelClasses &&
        last.filterMode === filterMode &&
        last.envTintById === envTintById &&
        last.cullViewport === cullViewport &&
        last.edgeStyle === edgeStyle &&
        last.searchMatches === searchMatches &&
        last.onNodeMouseDown === onNodeMouseDown &&
        last.onConnect === onConnect &&
        last.onSelect === onSelect &&
        last.onHover === onHover &&
        last.onToggleCollapse === onToggleCollapse &&
        last.onExpandGroup === onExpandGroup
      ) {
        return;
      }

      // Finding 3: coalesce structural redraws to one per animation frame.
      pendingRef.current = input;
      if (rafRef.current !== null) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        const next = pendingRef.current;
        pendingRef.current = null;
        if (next) renderStructure(next);
      });
    },
    [worldRef, svgRef, renderStructure],
  );

  // Finding 3: cancel any pending structural redraw frame on unmount.
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, []);

  const drawMinimap = useCallback(
    (
      resources: ResourceInstance[],
      layout: LayoutResult,
      viewport: Pan,
      view: { width: number; height: number },
    ) => {
      const canvas = minimapRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d")!;
      const w = (canvas.width = 180);
      const h = (canvas.height = 120);
      ctx.fillStyle = "#0a1020";
      ctx.fillRect(0, 0, w, h);

      // Fit BOTH the visible node bbox and the current viewport rectangle so the
      // viewport indicator stays visible even when panned away from the nodes.
      const visibleRects: Rect[] = [...layout.rects.values()];
      const content = boundsOf(visibleRects);
      const vpRect = viewportWorldRect(viewport, view);
      const t = minimapTransform(content, vpRect, { w, h });

      resources.forEach((r) => {
        const p = layout.rects.get(r.id);
        if (!p) return;
        const a = worldToMinimap(t, { x: p.x, y: p.y });
        ctx.fillStyle = serviceColor(r.serviceId);
        ctx.globalAlpha = 0.55;
        ctx.fillRect(a.x, a.y, p.w * t.scale, p.h * t.scale);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = "#36527e";
        ctx.strokeRect(a.x, a.y, p.w * t.scale, p.h * t.scale);
      });

      // Viewport indicator rectangle.
      const v = worldToMinimap(t, { x: vpRect.x, y: vpRect.y });
      const vw = vpRect.w * t.scale;
      const vh = vpRect.h * t.scale;
      ctx.fillStyle = "rgba(95,190,243,0.12)";
      ctx.fillRect(v.x, v.y, vw, vh);
      ctx.strokeStyle = "#5fbef3";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(v.x, v.y, vw, vh);
    },
    [minimapRef],
  );

  return { draw, drawMinimap };
}
