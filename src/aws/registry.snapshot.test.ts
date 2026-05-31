import { describe, it, expect } from "vitest";
import { allServices, servicesByCategory } from "./registry";
import { CATEGORY_ORDER, RELATIONSHIP_ORDER, RELATIONSHIPS } from "./categories";

/**
 * Snapshot tests pin down the *public registry contract* — the data surface that
 * the entire UI is derived from. Unit tests in `registry.test.ts` assert the
 * rules; these assert the shape, so an unintended catalog edit (a removed
 * service, a renamed relationship, a re-categorisation) shows up as a reviewable
 * diff rather than slipping through.
 *
 * When a change here is intentional, re-record with `npm run test:update` and
 * review the diff before committing.
 */
describe("registry contract snapshots", () => {
  it("groups a stable set of service ids under each category", () => {
    const byCategory = Object.fromEntries(
      CATEGORY_ORDER.map((id) => [
        id,
        servicesByCategory(id)
          .map((s) => s.id)
          .sort(),
      ]),
    );
    expect(byCategory).toMatchSnapshot();
  });

  it("exposes a stable relationship vocabulary", () => {
    const vocabulary = RELATIONSHIP_ORDER.map((kind) => {
      const def = RELATIONSHIPS[kind];
      return {
        kind: def.kind,
        label: def.label,
        symmetric: def.symmetric ?? false,
        style: def.style ?? "solid",
      };
    });
    expect(vocabulary).toMatchSnapshot();
  });

  it("exposes a stable, complete sorted list of service ids", () => {
    const ids = allServices()
      .map((s) => s.id)
      .sort();
    expect(ids).toMatchSnapshot();
  });
});
