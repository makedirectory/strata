/**
 * UI-facing types for the canvas.
 *
 * The canvas operates DIRECTLY on the domain model (`ResourceInstance` /
 * `Relationship` from `aws/model`) — there is no separate "flow node" shape.
 * A resource's canvas geometry lives in `ResourceInstance.position`. Visuals
 * (label, colour, icon, config fields) are derived from the service registry
 * via the resource's `serviceId`.
 */
import type { ResourceInstance, Relationship, Viewport } from "./aws/model";
import type { ServiceCategoryId } from "./aws/types";

export type { ResourceInstance, Relationship, Viewport } from "./aws/model";

/** Interaction mode for the canvas. */
export type CanvasMode = "move" | "connect";

/** Node information-density preset (Comfortable shows full cards, Compact trims). */
export type CanvasDensity = "comfortable" | "compact";

/** Semantic level-of-detail tier, derived from the effective zoom scale. */
export type LodTier = "far" | "mid" | "near";

/** An entry in the service palette, derived from a ServiceDefinition. */
export interface PaletteItem {
  readonly serviceId: string;
  readonly name: string;
  readonly icon: string;
  readonly color: string;
  readonly category: ServiceCategoryId;
}

/** Current selection on the canvas. */
export type Selection =
  | { type: "node"; id: string; resource: ResourceInstance }
  | { type: "edge"; id: string; relationship: Relationship; fromName: string; toName: string }
  | { type: "annotation"; id: string }
  | null;

/** Pan/zoom alias kept for readability in interaction code. */
export type Pan = Viewport;
