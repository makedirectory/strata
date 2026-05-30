---
sidebar_position: 4
title: Visual Mapping
---

# Visual Mapping Architecture

The UI is **registry-driven**: nothing about a service's appearance or its form
is hardcoded in components.

## Registry-driven UI

- **Palette** (`src/components/Palette.tsx`) renders sections from
  `CATEGORY_ORDER` and the services in each category, using `serviceIcon()` /
  `serviceColor()` and `searchServices()` for filtering.
- **Colours & icons** come from `serviceColor(id)` (per-service override →
  category colour fallback) and `serviceIcon(id)`. The category colour palette is
  the single source for the legend and node accenting.
- **Inspector** (`src/components/Inspector.tsx`) renders a dynamic form straight
  from the selected service's `configFields` — each `ConfigField.type` maps to an
  input widget. Adding a field to a catalog entry adds it to the form.

## Canvas on the model

The canvas (`src/components/Canvas.tsx` + `src/hooks/*`) operates on the domain
model: resources become nodes (positioned by `CanvasPosition`), and
`Relationship`s become **typed edges** styled by `RELATIONSHIPS[kind].style`
(solid/dashed) and labelled by `RELATIONSHIPS[kind].label`.

## Typed edges

Edges are never anonymous lines. Each carries a `RelationshipKind`, and the
renderer reads its presentation metadata from `RELATIONSHIPS` in
`src/aws/categories.ts` — the `label` and `solid`/`dashed` `style`. This is the
same vocabulary the MCP importer emits, so imported edges render identically to
hand-drawn ones.

## Interaction & state

Behaviour is split across hooks:

- `useFlowStore` holds resources/relationships/viewport/selection and exposes
  actions (`addResource`, `connect`, `updateResource`, `updateResourcePosition`,
  `removeSelection`, `duplicateSelection`, `replaceAll`, …).
- `useHistory` provides undo/redo.
- `useCanvasInteraction` handles pointer/drag/pan.
- `useCanvasRenderer` paints the world.

:::warning Renderer note (important for scale)
`useCanvasRenderer` is an _imperative full-redraw_ renderer — each `draw()` sets
`world.innerHTML = ""` and recreates every node DOM element from scratch. This is
fine for hand-built diagrams but will not scale to MCP-sized graphs. See
[Roadmap](./roadmap.md).
:::
