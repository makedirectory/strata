"use client";
import React from "react";
import { useFlow, useFlowCanvas } from "../hooks/useFlow";
import { nextInDirection, readingOrder, type NavRect, type NavDir } from "../canvas/navGrid";
import { worldToScreen } from "../canvas/geometry";
import type { CloudProvider } from "../aws/types";

/**
 * Keyboard- and screen-reader-accessible layer over the canvas.
 *
 * The diagram itself is drawn by an imperative renderer into an `aria-hidden`
 * surface, so it's invisible to assistive tech. This overlay mirrors each
 * visible node as a focusable, labelled element positioned over it (transparent
 * and `pointer-events: none`, so mouse users still hit the real nodes). It's a
 * single tab stop with roving `tabindex`; arrow keys move spatially between
 * nodes, Enter opens a container or recentres a leaf, Escape steps out of a
 * focused container.
 */
const ARROW_DIR: Record<string, NavDir> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

const PROVIDER_LABEL: Record<CloudProvider, string> = {
  aws: "AWS",
  gcp: "Google Cloud",
  azure: "Microsoft Azure",
};

export const AccessibleNodes: React.FC = () => {
  const { a11yNodes, selectNode, focusContainer, goToResource, focusedContainerId, selectedIds } =
    useFlow();
  const { viewport } = useFlowCanvas();
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const refs = React.useRef<Map<string, HTMLButtonElement>>(new Map());

  const rects = React.useMemo<NavRect[]>(
    () => a11yNodes.map((n) => ({ id: n.id, x: n.x, y: n.y, w: n.w, h: n.h })),
    [a11yNodes],
  );
  const order = React.useMemo(() => readingOrder(rects), [rects]);

  // Keep the roving focus target valid as the visible set changes (filters,
  // container focus, deletion). Prefer the current selection, else reading-order
  // first.
  React.useEffect(() => {
    if (a11yNodes.length === 0) {
      if (activeId !== null) setActiveId(null);
      return;
    }
    if (!activeId || !a11yNodes.some((n) => n.id === activeId)) {
      const sel = selectedIds.find((id) => a11yNodes.some((n) => n.id === id));
      setActiveId(sel ?? order[0] ?? null);
    }
  }, [a11yNodes, activeId, order, selectedIds]);

  if (a11yNodes.length === 0) return null;

  const tabId = activeId && a11yNodes.some((n) => n.id === activeId) ? activeId : order[0];

  const focus = (id: string | null | undefined) => {
    if (id) refs.current.get(id)?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent, node: (typeof a11yNodes)[number]) => {
    const dir = ARROW_DIR[e.key];
    if (dir) {
      e.preventDefault();
      focus(nextInDirection(rects, node.id, dir));
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (node.isContainer) {
        // Commit selection on the explicit activate (roving focus alone doesn't).
        selectNode(node.id);
        focusContainer(node.id);
      } else {
        // goToResource selects + recentres the leaf.
        goToResource(node.id);
      }
      return;
    }
    if (e.key === "Escape" && focusedContainerId) {
      e.preventDefault();
      focusContainer(null);
      return;
    }
    if (e.key === "Home") {
      e.preventDefault();
      focus(order[0]);
    }
    if (e.key === "End") {
      e.preventDefault();
      focus(order[order.length - 1]);
    }
  };

  const summary =
    `Infrastructure diagram. ${a11yNodes.length} ` +
    `${a11yNodes.length === 1 ? "resource" : "resources"}` +
    `${focusedContainerId ? ", focused inside a container" : ""}. ` +
    `Use the arrow keys to move between resources, Enter to open a container, ` +
    `Escape to step out.`;

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-to-interactive-role
    <div className="a11y-nodes" role="application" aria-label={summary}>
      {a11yNodes.map((n) => {
        const selected = selectedIds.includes(n.id);
        // Single source of truth for the world→screen projection.
        const origin = worldToScreen({ x: n.x, y: n.y }, viewport);
        const label =
          `${n.name}, ${n.serviceName}, ${PROVIDER_LABEL[n.provider]}` +
          `${n.isContainer ? ", container" : ""}` +
          `${n.parentName ? `, inside ${n.parentName}` : ""}` +
          `${selected ? ", selected" : ""}`;
        return (
          <button
            key={n.id}
            type="button"
            ref={(el) => {
              if (el) refs.current.set(n.id, el);
              else refs.current.delete(n.id);
            }}
            className="a11y-node"
            tabIndex={n.id === tabId ? 0 : -1}
            aria-pressed={selected}
            aria-label={label}
            // Roving focus only — does NOT commit selection, so arrow-key
            // exploration doesn't clobber an existing multi-selection or churn
            // the Inspector on every keystroke. Enter/Space commits (see onKeyDown).
            onFocus={() => setActiveId(n.id)}
            onKeyDown={(e) => onKeyDown(e, n)}
            style={{
              left: origin.x,
              top: origin.y,
              width: n.w * viewport.scale,
              height: n.h * viewport.scale,
            }}
          />
        );
      })}
    </div>
  );
};
