/**
 * Strata — Annotation Layer
 * ------------------------------------
 * A presentation-only overlay of free-form notes, callouts and zones drawn on
 * top of an architecture diagram. Annotations are NOT infrastructure: they have
 * no provider, no cost, no IaC representation and never participate in
 * validation. They exist purely to let an author label, group or comment on a
 * region of the canvas.
 *
 * Annotations live structurally on the graph at `graph.annotations` via the
 * {@link AnnotationGraph} extension. This engine reads and writes that field
 * without depending on (or modifying) the core `InfrastructureGraph` model: it
 * treats the host graph as a plain object so it stays decoupled from
 * `src/aws/model.ts`. (Integrator note below describes the one-line model
 * change that makes the field first-class.)
 *
 * Pure and framework-free: every mutating helper returns a NEW graph object
 * with a NEW `annotations` array — inputs are never mutated. No DOM, network or
 * credentials.
 *
 * INTEGRATOR NOTE — annotations MUST be excluded from the data engines:
 *   - rules.ts `validateArchitecture`: never emit findings for annotations.
 *   - cost.ts `estimateTotal` / `estimateMonthlyCost`: never cost annotations.
 *   - iac.ts / iacExport.ts: never emit annotations as IaC resources.
 *   - localStore.ts: annotations ride on the graph and persist automatically
 *     through save/load (the validator only asserts id/name/resources/
 *     relationships, so the extra optional `annotations` array survives the
 *     round-trip). No localStore change is required.
 */
import type { InfrastructureGraph } from "./model";

/** The visual kind of an annotation. */
export type AnnotationKind = "note" | "callout" | "zone";

/**
 * Per-kind creation policy: the single source of truth for the human label, the
 * default text and the default size used when a new annotation of a given kind
 * is created. Consumers (the store's create helper, the Inspector label, the
 * command palette's Add-* entries) all read from here so the three never drift.
 */
export interface AnnotationKindDefaults {
  /** Human-facing label (Inspector heading, command titles). */
  label: string;
  /** Default `text` for a freshly created annotation of this kind. */
  defaultText: string;
  /** Default width (world units); zones get a sizeable backdrop, others none. */
  defaultW?: number;
  /** Default height (world units); zones get a sizeable backdrop, others none. */
  defaultH?: number;
}

/**
 * The per-kind defaults table — the authoritative map keyed by
 * {@link AnnotationKind}. Adding a new kind to the union forces a new entry here
 * (the `Record` is exhaustive), which in turn flows to {@link ANNOTATION_KINDS}
 * and every consumer.
 */
export const ANNOTATION_KIND_DEFAULTS: Record<AnnotationKind, AnnotationKindDefaults> = {
  note: { label: "Note", defaultText: "Note" },
  callout: { label: "Callout", defaultText: "Callout" },
  // Zones default to a sizeable region (they sit behind nodes as a backdrop).
  zone: { label: "Zone", defaultText: "Zone", defaultW: 360, defaultH: 240 },
};

/** Runtime list of every valid {@link AnnotationKind}, derived from the table. */
export const ANNOTATION_KINDS = Object.keys(ANNOTATION_KIND_DEFAULTS) as AnnotationKind[];

const ANNOTATION_KIND_SET: ReadonlySet<string> = new Set(ANNOTATION_KINDS);

/** True when `kind` is one of the known {@link AnnotationKind} values. */
export function isAnnotationKind(kind: unknown): kind is AnnotationKind {
  return typeof kind === "string" && ANNOTATION_KIND_SET.has(kind);
}

/**
 * A single canvas annotation.
 *
 * - `note`    — a free-text sticky anchored at (x, y).
 * - `callout` — a labelled pointer; pair with `targetId` to reference a node.
 * - `zone`    — a rectangular region (use `w`/`h`) grouping nodes visually.
 *
 * `x`/`y` are canvas coordinates; `w`/`h` are optional sizes (relevant for
 * zones). `color` is an optional CSS color string; `targetId` optionally links
 * the annotation to a `ResourceInstance.id`.
 */
export interface Annotation {
  id: string;
  kind: AnnotationKind;
  text: string;
  x: number;
  y: number;
  w?: number;
  h?: number;
  color?: string;
  targetId?: string;
}

/**
 * Structural extension of {@link InfrastructureGraph} carrying the annotation
 * layer. The core model does not (yet) declare this field; this engine reads
 * and writes it via the extension so it stays decoupled from `model.ts`.
 */
export interface AnnotationGraph extends InfrastructureGraph {
  annotations?: Annotation[];
}

/** A finite number (rejects NaN / ±Infinity that would corrupt canvas math). */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * True when `value` is a CSS color safe to inject into a custom property / SVG
 * `stroke` from an untrusted source (e.g. a share link). Allows only a tight
 * allow-list — anything able to break out of the value (`;`, `:`, `url(`,
 * parentheses outside an `rgb()`/`rgba()`/`var()` form, etc.) is rejected:
 *   - a `#hex` color with 3, 6 or 8 hex digits;
 *   - an `rgb(...)` / `rgba(...)` form (digits, commas, dots, %, spaces only);
 *   - a CSS custom-property reference `var(--…)`;
 *   - a plain CSS named-color token (`[A-Za-z]+`, e.g. `tomato`).
 */
export function isSafeAnnotationColor(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const v = value.trim();
  if (v.length === 0) return false;
  if (/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v)) return true;
  if (/^rgba?\(\s*[0-9.,%\s/]+\)$/.test(v)) return true;
  if (/^var\(\s*--[A-Za-z0-9_-]+\s*\)$/.test(v)) return true;
  if (/^[A-Za-z]+$/.test(v)) return true;
  return false;
}

/**
 * Runtime type guard validating the SHAPE of a single value as an
 * {@link Annotation}. Uses `unknown` + narrowing (no `any`).
 */
export function isAnnotation(value: unknown): value is Annotation {
  if (typeof value !== "object" || value === null) return false;
  const a = value as Record<string, unknown>;
  if (typeof a.id !== "string" || a.id.length === 0) return false;
  if (!isAnnotationKind(a.kind)) return false;
  if (typeof a.text !== "string") return false;
  if (!isFiniteNumber(a.x) || !isFiniteNumber(a.y)) return false;
  if (a.w !== undefined && !isFiniteNumber(a.w)) return false;
  if (a.h !== undefined && !isFiniteNumber(a.h)) return false;
  if (a.color !== undefined && typeof a.color !== "string") return false;
  if (a.targetId !== undefined && typeof a.targetId !== "string") return false;
  return true;
}

/**
 * Runtime type guard for a graph that carries a well-formed annotation layer.
 * Returns true when `annotations` is absent (a plain graph is a valid
 * annotation graph with an empty layer) or is an array of valid annotations.
 */
export function isAnnotationGraph(graph: InfrastructureGraph): graph is AnnotationGraph {
  const candidate = (graph as AnnotationGraph).annotations;
  if (candidate === undefined) return true;
  return Array.isArray(candidate) && candidate.every(isAnnotation);
}

/**
 * Read the annotation layer off a graph. Returns a fresh array (safe to hold);
 * returns `[]` when the field is absent or malformed.
 */
export function listAnnotations(graph: InfrastructureGraph): Annotation[] {
  const candidate = (graph as AnnotationGraph).annotations;
  if (!Array.isArray(candidate)) return [];
  return candidate.filter(isAnnotation).map(cloneAnnotation);
}

/** Deep-ish clone of an annotation (it's a flat object of primitives). */
function cloneAnnotation(a: Annotation): Annotation {
  const copy: Annotation = { id: a.id, kind: a.kind, text: a.text, x: a.x, y: a.y };
  if (a.w !== undefined) copy.w = a.w;
  if (a.h !== undefined) copy.h = a.h;
  if (a.color !== undefined) copy.color = a.color;
  if (a.targetId !== undefined) copy.targetId = a.targetId;
  return copy;
}

/**
 * Return a NEW graph with `annotations` replaced by `next`. Internal helper for
 * the mutating ops — never mutates the input graph or its arrays.
 */
function withAnnotations(graph: InfrastructureGraph, next: Annotation[]): AnnotationGraph {
  return { ...(graph as AnnotationGraph), annotations: next };
}

/**
 * Clamp/normalise an annotation's geometry so it stays well-formed:
 * coordinates are forced finite (non-finite → 0) and any `w`/`h` is forced to a
 * non-negative finite value. Returns a NEW annotation; never mutates the input.
 * Useful before persisting drag/resize results from the canvas.
 */
export function clampAnnotation(a: Annotation): Annotation {
  const next = cloneAnnotation(a);
  next.x = isFiniteNumber(a.x) ? a.x : 0;
  next.y = isFiniteNumber(a.y) ? a.y : 0;
  if (a.w !== undefined) next.w = isFiniteNumber(a.w) && a.w > 0 ? a.w : 0;
  if (a.h !== undefined) next.h = isFiniteNumber(a.h) && a.h > 0 ? a.h : 0;
  return next;
}

// ---- array-level ops -------------------------------------------------------
// The primitives below operate on an `Annotation[]` directly so callers that
// already hold an annotation slice (e.g. the canvas store) don't have to wrap
// it in a throwaway graph. The graph-shaped helpers further down are thin
// adapters over these — behaviour is identical.

/**
 * Add `annotation` to `list`, returning a NEW array. If an entry with the same
 * id already exists it is replaced (upsert), keeping the layer free of
 * duplicate ids. The annotation is clamped before insertion. The input array is
 * never mutated.
 */
export function addTo(list: readonly Annotation[], annotation: Annotation): Annotation[] {
  const clamped = clampAnnotation(annotation);
  const idx = list.findIndex((a) => a.id === clamped.id);
  const next = list.slice();
  if (idx >= 0) {
    next[idx] = clamped;
  } else {
    next.push(clamped);
  }
  return next;
}

/**
 * Apply a partial patch to the entry with the given `id`, returning a NEW array.
 * `id` itself cannot be changed. A no-op (returns a fresh copy) when the id is
 * not found. The patched annotation is clamped. The input array is never mutated.
 */
export function updateIn(
  list: readonly Annotation[],
  id: string,
  patch: Partial<Omit<Annotation, "id">>,
): Annotation[] {
  const idx = list.findIndex((a) => a.id === id);
  if (idx < 0) return list.slice();
  const next = list.slice();
  next[idx] = clampAnnotation({ ...list[idx], ...patch, id });
  return next;
}

/**
 * Remove the entry with the given `id`, returning a NEW array. A no-op (returns
 * a fresh copy) when the id is not found. The input array is never mutated.
 */
export function removeFrom(list: readonly Annotation[], id: string): Annotation[] {
  return list.filter((a) => a.id !== id);
}

// ---- graph-shaped ops (thin adapters over the array-level ops) -------------

/**
 * Add an annotation. Returns a NEW graph. If an annotation with the same id
 * already exists it is replaced (upsert), keeping the layer free of duplicate
 * ids. The annotation is clamped before insertion.
 */
export function addAnnotation(
  graph: InfrastructureGraph,
  annotation: Annotation,
): InfrastructureGraph {
  return withAnnotations(graph, addTo(listAnnotations(graph), annotation));
}

/**
 * Apply a partial patch to the annotation with the given `id`. `id` itself
 * cannot be changed. Returns a NEW graph; a no-op (equivalent new graph) when
 * the id is not found. The patched annotation is clamped.
 */
export function updateAnnotation(
  graph: InfrastructureGraph,
  id: string,
  patch: Partial<Omit<Annotation, "id">>,
): InfrastructureGraph {
  return withAnnotations(graph, updateIn(listAnnotations(graph), id, patch));
}

/**
 * Remove the annotation with the given `id`. Returns a NEW graph; a no-op
 * (equivalent new graph) when the id is not found.
 */
export function removeAnnotation(graph: InfrastructureGraph, id: string): InfrastructureGraph {
  return withAnnotations(graph, removeFrom(listAnnotations(graph), id));
}
