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

/** Runtime list of every valid {@link AnnotationKind}, for guard checks. */
export const ANNOTATION_KINDS = ["note", "callout", "zone"] as const satisfies readonly AnnotationKind[];

// Exhaustiveness guard (type-only): adding a kind to the union without adding
// it to ANNOTATION_KINDS makes `MissingKinds` non-`never` and fails to compile.
type MissingKinds = Exclude<AnnotationKind, (typeof ANNOTATION_KINDS)[number]>;
type _AssertNoMissingKinds = MissingKinds extends never ? true : never;
const _assertAllKindsCovered: _AssertNoMissingKinds = true;
void _assertAllKindsCovered;

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

/**
 * Add an annotation. Returns a NEW graph. If an annotation with the same id
 * already exists it is replaced (upsert), keeping the layer free of duplicate
 * ids. The annotation is clamped before insertion.
 */
export function addAnnotation(graph: InfrastructureGraph, annotation: Annotation): InfrastructureGraph {
  const clamped = clampAnnotation(annotation);
  const current = listAnnotations(graph);
  const idx = current.findIndex((a) => a.id === clamped.id);
  const next = current.slice();
  if (idx >= 0) {
    next[idx] = clamped;
  } else {
    next.push(clamped);
  }
  return withAnnotations(graph, next);
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
  const current = listAnnotations(graph);
  const idx = current.findIndex((a) => a.id === id);
  if (idx < 0) return withAnnotations(graph, current);
  const merged: Annotation = clampAnnotation({ ...current[idx], ...patch, id });
  const next = current.slice();
  next[idx] = merged;
  return withAnnotations(graph, next);
}

/**
 * Remove the annotation with the given `id`. Returns a NEW graph; a no-op
 * (equivalent new graph) when the id is not found.
 */
export function removeAnnotation(graph: InfrastructureGraph, id: string): InfrastructureGraph {
  const current = listAnnotations(graph);
  const next = current.filter((a) => a.id !== id);
  return withAnnotations(graph, next);
}
