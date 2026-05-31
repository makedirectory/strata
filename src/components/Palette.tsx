"use client";
import React, { useMemo, useState } from "react";
import { CATEGORIES, CATEGORY_ORDER } from "../aws/categories";
import { servicesByCategory, searchServices, serviceColor, serviceProvider } from "../aws/registry";
import type { ServiceDefinition, ServiceCategoryId, CloudProvider } from "../aws/types";

/**
 * Custom event the Palette dispatches when a service item is activated via
 * mouse click or keyboard (Enter/Space). The Canvas listens for it and adds the
 * resource near the centre of the viewport. Using an event keeps the Palette
 * self-contained (no FlowProvider dependency) so it can be unit-tested in
 * isolation.
 */
export const PALETTE_ADD_EVENT = "palette:add-service";

/** Provider filter options. "all" shows every cloud (multi-cloud diagrams). */
type ProviderFilter = "all" | CloudProvider;

const PROVIDER_FILTERS: { value: ProviderFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "aws", label: "AWS" },
  { value: "gcp", label: "GCP" },
  { value: "azure", label: "Azure" },
];

/** Short provider badge shown on each item so mixed-cloud views stay legible. */
const PROVIDER_BADGE: Record<CloudProvider, string> = { aws: "AWS", gcp: "GCP", azure: "AZ" };

export const Palette: React.FC<{ readOnly?: boolean }> = ({ readOnly = false }) => {
  const [query, setQuery] = useState("");
  const [provider, setProvider] = useState<ProviderFilter>("all");

  /** Activation (click / keyboard): ask the canvas to add the service. */
  const addToCanvas = (serviceId: string) => {
    if (readOnly || typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent(PALETTE_ADD_EVENT, { detail: { serviceId } }));
  };

  /** Group rendered services by category, honoring the search + provider filter. */
  const sections = useMemo(() => {
    const filter = provider === "all" ? undefined : provider;
    const matched = new Set(searchServices(query, filter).map((s) => s.id));
    const result: { category: ServiceCategoryId; services: ServiceDefinition[] }[] = [];
    for (const id of CATEGORY_ORDER) {
      const services = servicesByCategory(id, filter).filter((s) => matched.has(s.id));
      if (services.length > 0) result.push({ category: id, services });
    }
    return result;
  }, [query, provider]);

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
      <div className="palette-providers" role="group" aria-label="Filter by cloud provider">
        {PROVIDER_FILTERS.map((p) => (
          <button
            key={p.value}
            type="button"
            className={`palette-provider${provider === p.value ? " is-active" : ""}`}
            aria-pressed={provider === p.value}
            onClick={() => setProvider(p.value)}
          >
            {p.label}
          </button>
        ))}
      </div>
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
                  <span className="palette-item-provider">
                    {PROVIDER_BADGE[serviceProvider(s)]}
                  </span>
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
