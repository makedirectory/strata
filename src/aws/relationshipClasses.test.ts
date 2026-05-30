import { describe, it, expect } from "vitest";
import {
  relationshipClassOf,
  relationshipClassDef,
  RELATIONSHIP_CLASSES,
  RELATIONSHIP_CLASS_ORDER,
} from "./relationshipClasses";
import { RELATIONSHIP_KINDS } from "./model";

describe("relationshipClasses", () => {
  it("classifies representative kinds", () => {
    expect(relationshipClassOf("routes_to")).toBe("network");
    expect(relationshipClassOf("peers_with")).toBe("network");
    expect(relationshipClassOf("writes_to")).toBe("data");
    expect(relationshipClassOf("depends_on")).toBe("dependency");
    expect(relationshipClassOf("allows")).toBe("permission");
    expect(relationshipClassOf("monitors")).toBe("observability");
    expect(relationshipClassOf("contains")).toBe("containment");
  });

  it("maps every RelationshipKind to a defined class", () => {
    for (const kind of RELATIONSHIP_KINDS) {
      const cls = relationshipClassOf(kind);
      expect(RELATIONSHIP_CLASSES[cls]).toBeDefined();
      expect(RELATIONSHIP_CLASS_ORDER).toContain(cls);
    }
  });

  it("exposes a styling def (colour + dash) per kind", () => {
    const def = relationshipClassDef("reads_from");
    expect(def.id).toBe("data");
    expect(def.color).toMatch(/^#/);
    // data flow is a solid line
    expect(def.dash).toBeNull();
    // dependency is dashed
    expect(relationshipClassDef("depends_on").dash).not.toBeNull();
  });

  it("orders every class exactly once", () => {
    expect([...RELATIONSHIP_CLASS_ORDER].sort()).toEqual(Object.keys(RELATIONSHIP_CLASSES).sort());
  });
});
