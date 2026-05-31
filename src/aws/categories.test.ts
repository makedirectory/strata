import { describe, it, expect } from "vitest";
import {
  CATEGORIES,
  CATEGORY_ORDER,
  RELATIONSHIPS,
  RELATIONSHIP_ORDER,
  getCategory,
} from "./categories";
import type { ServiceCategoryId, RelationshipKind } from "./types";

// The full set of category ids, kept in sync with the ServiceCategoryId union.
const ALL_CATEGORY_IDS: ServiceCategoryId[] = [
  "networking",
  "compute",
  "containers",
  "storage",
  "database",
  "integration",
  "security",
  "identity",
  "monitoring",
  "analytics",
  "ai-ml",
  "deployment",
  "management",
  "edge",
];

// The full set of relationship kinds, kept in sync with the RelationshipKind union.
const ALL_RELATIONSHIP_KINDS: RelationshipKind[] = [
  "contains",
  "attached_to",
  "routes_to",
  "depends_on",
  "allows",
  "targets",
  "reads_from",
  "writes_to",
  "invokes",
  "publishes_to",
  "subscribes_to",
  "assumes",
  "grants",
  "monitors",
  "peers_with",
  "connects_to",
];

describe("CATEGORIES", () => {
  it("has an entry for every ServiceCategoryId", () => {
    for (const id of ALL_CATEGORY_IDS) {
      expect(CATEGORIES[id], `missing category: ${id}`).toBeDefined();
    }
  });

  it("has no entries beyond the known category ids", () => {
    expect(Object.keys(CATEGORIES).sort()).toEqual([...ALL_CATEGORY_IDS].sort());
  });

  it("uses a self-consistent id on each entry", () => {
    for (const id of ALL_CATEGORY_IDS) {
      expect(CATEGORIES[id].id).toBe(id);
    }
  });

  it("provides a name, description, hex colour and icon for each category", () => {
    for (const id of ALL_CATEGORY_IDS) {
      const c = CATEGORIES[id];
      expect(c.name.length).toBeGreaterThan(0);
      expect(c.description.length).toBeGreaterThan(0);
      expect(c.color).toMatch(/^#[0-9a-fA-F]{3,8}$/);
      expect(c.icon.length).toBeGreaterThan(0);
    }
  });
});

describe("CATEGORY_ORDER", () => {
  it("covers every category exactly once", () => {
    expect(CATEGORY_ORDER.length).toBe(ALL_CATEGORY_IDS.length);
    expect(new Set(CATEGORY_ORDER).size).toBe(CATEGORY_ORDER.length);
    expect([...CATEGORY_ORDER].sort()).toEqual([...ALL_CATEGORY_IDS].sort());
  });

  it("only references ids that exist in CATEGORIES", () => {
    for (const id of CATEGORY_ORDER) {
      expect(CATEGORIES[id]).toBeDefined();
    }
  });
});

describe("getCategory", () => {
  it("returns the matching category definition", () => {
    for (const id of ALL_CATEGORY_IDS) {
      expect(getCategory(id)).toBe(CATEGORIES[id]);
    }
  });
});

describe("RELATIONSHIPS", () => {
  it("has an entry for every RelationshipKind", () => {
    for (const kind of ALL_RELATIONSHIP_KINDS) {
      expect(RELATIONSHIPS[kind], `missing relationship: ${kind}`).toBeDefined();
    }
  });

  it("has no entries beyond the known relationship kinds", () => {
    expect(Object.keys(RELATIONSHIPS).sort()).toEqual([...ALL_RELATIONSHIP_KINDS].sort());
  });

  it("uses a self-consistent kind on each entry", () => {
    for (const kind of ALL_RELATIONSHIP_KINDS) {
      expect(RELATIONSHIPS[kind].kind).toBe(kind);
    }
  });

  it("provides a label, description and valid style for each relationship", () => {
    for (const kind of ALL_RELATIONSHIP_KINDS) {
      const r = RELATIONSHIPS[kind];
      expect(r.label.length).toBeGreaterThan(0);
      expect(r.description.length).toBeGreaterThan(0);
      if (r.style !== undefined) {
        expect(["solid", "dashed"]).toContain(r.style);
      }
    }
  });

  it("marks peers_with as symmetric", () => {
    expect(RELATIONSHIPS.peers_with.symmetric).toBe(true);
  });
});

describe("RELATIONSHIP_ORDER", () => {
  it("covers every relationship kind exactly once", () => {
    expect(RELATIONSHIP_ORDER.length).toBe(ALL_RELATIONSHIP_KINDS.length);
    expect(new Set(RELATIONSHIP_ORDER).size).toBe(RELATIONSHIP_ORDER.length);
    expect([...RELATIONSHIP_ORDER].sort()).toEqual([...ALL_RELATIONSHIP_KINDS].sort());
  });

  it("only references kinds that exist in RELATIONSHIPS", () => {
    for (const kind of RELATIONSHIP_ORDER) {
      expect(RELATIONSHIPS[kind]).toBeDefined();
    }
  });
});
