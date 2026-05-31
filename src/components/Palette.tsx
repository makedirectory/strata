"use client";
import React, { useMemo, useState } from "react";
import { CATEGORIES, CATEGORY_ORDER } from "../aws/categories";
import { servicesByCategory, searchServices, serviceColor } from "../aws/registry";
import type { ServiceDefinition, ServiceCategoryId } from "../aws/types";

/**
 * Custom event the Palette dispatches when a service item is activated via
 * mouse click or keyboard (Enter/Space). The Canvas listens for it and adds the
 * resource near the centre of the viewport. Using an event keeps the Palette
 * self-contained (no FlowProvider dependency) so it can be unit-tested in
 * isolation.
 */
export const PALETTE_ADD_EVENT = "palette:add-service";

export const Palette: React.FC<{ readOnly?: boolean }> = ({ readOnly = false }) => {
  const [query, setQuery] = useState("");

  /** Activation (click / keyboard): ask the canvas to add the service. */
  const addToCanvas = (serviceId: string) => {
    if (readOnly || typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent(PALETTE_ADD_EVENT, { detail: { serviceId } }));
  };

  /** Group rendered services by category, honoring the search filter. */
  const sections = useMemo(() => {
    const matched = new Set(searchServices(query).map((s) => s.id));
    const result: { category: ServiceCategoryId; services: ServiceDefinition[] }[] = [];
    for (const id of CATEGORY_ORDER) {
      const services = servicesByCategory(id).filter((s) => matched.has(s.id));
      if (services.length > 0) result.push({ category: id, services });
    }
    return result;
  }, [query]);

  return (
    <div className="palette-root">
      <input
        className="palette-search"
        type="text"
        aria-label="Search services"
        placeholder="Search services…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {sections.map(({ category, services }) => {
        const cat = CATEGORIES[category];
        return (
          <div key={category} className="palette-section">
            <div className="palette-section-header">
              <span className="palette-section-icon">{cat.icon}</span>
              <span>{cat.name}</span>
            </div>
            <div className="palette-items">
              {services.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className="item"
                  draggable={!readOnly}
                  disabled={readOnly}
                  title={s.fullName}
                  aria-label={`Add ${s.fullName}`}
                  style={{ borderColor: serviceColor(s.id) }}
                  onDragStart={(e) => {
                    if (readOnly) {
                      e.preventDefault();
                      return;
                    }
                    e.dataTransfer.setData("application/json", JSON.stringify({ serviceId: s.id }));
                  }}
                  onClick={() => addToCanvas(s.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      addToCanvas(s.id);
                    }
                  }}
                >
                  <span className="palette-item-icon" style={{ color: serviceColor(s.id) }}>
                    {s.icon}
                  </span>
                  <span className="palette-item-name">{s.name}</span>
                </button>
              ))}
            </div>
          </div>
        );
      })}
      {sections.length === 0 && <div className="help">No services match “{query}”.</div>}
    </div>
  );
};
