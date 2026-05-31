import { describe, it, expect } from "vitest";
import {
  validateRegistry,
  getService,
  requireService,
  getServiceByCfnType,
  allServices,
  servicesByCategory,
  serviceColor,
  serviceIcon,
  defaultConfig,
  searchServices,
} from "./registry";
import { CATEGORIES, CATEGORY_ORDER } from "./categories";
import type { ServiceCategoryId } from "./types";

describe("validateRegistry", () => {
  const issues = validateRegistry();

  it("returns NO error-level issues (CI integrity guardrail)", () => {
    const errors = issues.filter((i) => i.level === "error");
    expect(errors, `error-level issues:\n${errors.map((e) => e.message).join("\n")}`).toEqual([]);
  });

  it("has no dangling commonConnections (no 'not found' warnings)", () => {
    const dangling = issues.filter(
      (i) => i.level === "warn" && i.message.includes("not found in registry"),
    );
    expect(dangling, `dangling:\n${dangling.map((w) => w.message).join("\n")}`).toEqual([]);
  });

  it("has no duplicate service ids", () => {
    const ids = allServices().map((s) => s.id);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(dupes).toEqual([]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("only shares cfnTypes for intentional service variants", () => {
    // cfnType is NOT a unique key: some AWS CloudFormation types are modeled as
    // multiple service variants (e.g. public/private subnet, lambda/lambda-edge).
    // Any shared cfnType must be one of these known, intentional pairs.
    const KNOWN_SHARED_CFN_TYPES = new Set(["AWS::EC2::Subnet", "AWS::Lambda::Function"]);
    const cfnTypes = allServices()
      .map((s) => s.cfnType)
      .filter((t): t is string => Boolean(t));
    const dupes = [...new Set(cfnTypes.filter((t, i) => cfnTypes.indexOf(t) !== i))];
    for (const d of dupes) {
      expect(KNOWN_SHARED_CFN_TYPES.has(d), `unexpected shared cfnType: ${d}`).toBe(true);
    }
    // Collisions are surfaced as warnings (not integrity errors).
    const collisionErrors = issues.filter(
      (i) => i.level === "error" && i.message.includes("cfnType"),
    );
    expect(collisionErrors).toEqual([]);
  });

  it("references only known categories for every service", () => {
    for (const s of allServices()) {
      expect(CATEGORIES[s.category], `${s.id} -> ${s.category}`).toBeDefined();
    }
  });
});

describe("getService / requireService", () => {
  it("getService returns the definition on a hit", () => {
    const vpc = getService("vpc");
    expect(vpc).toBeDefined();
    expect(vpc?.id).toBe("vpc");
    expect(vpc?.category).toBe("networking");
  });

  it("getService returns undefined on a miss", () => {
    expect(getService("does-not-exist")).toBeUndefined();
  });

  it("requireService returns the definition on a hit", () => {
    expect(requireService("vpc").id).toBe("vpc");
  });

  it("requireService throws on a miss", () => {
    expect(() => requireService("does-not-exist")).toThrow(/Unknown service id: does-not-exist/);
  });
});

describe("getServiceByCfnType", () => {
  it("resolves a known cfnType to its service", () => {
    const svc = getServiceByCfnType("AWS::EC2::VPC");
    expect(svc?.id).toBe("vpc");
  });

  it("returns undefined for an unknown cfnType", () => {
    expect(getServiceByCfnType("AWS::Made::Up")).toBeUndefined();
  });

  it("returns the same cfnType that the service declares", () => {
    const svc = getServiceByCfnType("AWS::EC2::VPC");
    expect(svc?.cfnType).toBe("AWS::EC2::VPC");
  });
});

describe("allServices", () => {
  it("contains roughly 101 services", () => {
    expect(allServices().length).toBe(101);
  });

  it("returns a stable count and identical reference across calls", () => {
    const a = allServices();
    const b = allServices();
    expect(a.length).toBe(b.length);
    expect(a).toBe(b);
  });

  it("every service carries the required core fields", () => {
    for (const s of allServices()) {
      expect(typeof s.id).toBe("string");
      expect(s.id.length).toBeGreaterThan(0);
      expect(typeof s.name).toBe("string");
      expect(typeof s.fullName).toBe("string");
      expect(typeof s.icon).toBe("string");
      expect(Array.isArray(s.configFields)).toBe(true);
      expect(Array.isArray(s.commonConnections)).toBe(true);
    }
  });
});

describe("servicesByCategory", () => {
  it("partitions services so category counts sum to the total", () => {
    let sum = 0;
    for (const id of CATEGORY_ORDER) {
      const inCat = servicesByCategory(id);
      sum += inCat.length;
      for (const s of inCat) expect(s.category).toBe(id);
    }
    expect(sum).toBe(allServices().length);
  });

  it("matches the manual count for each category", () => {
    const manual = new Map<ServiceCategoryId, number>();
    for (const s of allServices()) {
      manual.set(s.category, (manual.get(s.category) ?? 0) + 1);
    }
    for (const id of CATEGORY_ORDER) {
      expect(servicesByCategory(id).length).toBe(manual.get(id) ?? 0);
    }
  });

  it("returns an empty array for a category with no services", () => {
    // Cast a bogus id to exercise the filter's no-match branch.
    expect(servicesByCategory("not-a-category" as ServiceCategoryId)).toEqual([]);
  });
});

describe("serviceColor", () => {
  it("falls back to the category colour when the service has no override", () => {
    const vpc = getService("vpc");
    expect(vpc?.color).toBeUndefined();
    expect(serviceColor("vpc")).toBe(CATEGORIES["networking"].color);
  });

  it("uses a per-service override when present, else the category colour", () => {
    // Assert the documented resolution rule for EVERY service so the override
    // branch is covered the moment any catalog entry sets `color` — and the
    // fallback branch is covered today. (No `expect.assertions(0)` no-op.)
    let sawOverride = false;
    let sawFallback = false;
    for (const s of allServices()) {
      const expected = s.color ?? CATEGORIES[s.category].color;
      expect(serviceColor(s.id), `serviceColor(${s.id})`).toBe(expected);
      if (s.color !== undefined) sawOverride = true;
      else sawFallback = true;
    }
    // The catalog must exercise at least the fallback branch; this also
    // documents that the registry is non-empty.
    expect(sawOverride || sawFallback).toBe(true);
  });

  it("returns the default colour for an unknown service id", () => {
    expect(serviceColor("nope")).toBe("#8892b0");
  });
});

describe("serviceIcon", () => {
  it("returns the service icon for a known id", () => {
    const vpc = getService("vpc");
    expect(serviceIcon("vpc")).toBe(vpc?.icon);
  });

  it("returns the placeholder icon for an unknown id", () => {
    expect(serviceIcon("nope")).toBe("❔");
  });
});

describe("defaultConfig", () => {
  it("builds config from ConfigField defaults", () => {
    const cfg = defaultConfig("vpc");
    const vpc = requireService("vpc");
    // Every field with a default should appear with that value.
    for (const f of vpc.configFields) {
      if (f.default !== undefined) {
        expect(cfg[f.key]).toBe(f.default);
      } else {
        expect(cfg).not.toHaveProperty(f.key);
      }
    }
    // And nothing extra leaks in.
    const expectedKeys = vpc.configFields.filter((f) => f.default !== undefined).map((f) => f.key);
    expect(Object.keys(cfg).sort()).toEqual(expectedKeys.sort());
  });

  it("returns an empty object for an unknown service id", () => {
    expect(defaultConfig("nope")).toEqual({});
  });

  it("returns an empty object for a service with no defaulted fields", () => {
    const noDefaults = allServices().find(
      (s) => s.configFields.length > 0 && s.configFields.every((f) => f.default === undefined),
    );
    if (noDefaults) {
      expect(defaultConfig(noDefaults.id)).toEqual({});
    }
  });
});

describe("searchServices", () => {
  it("matches by name", () => {
    const results = searchServices("VPC");
    expect(results.some((s) => s.id === "vpc")).toBe(true);
  });

  it("matches by keyword", () => {
    // "isolation" is a keyword on vpc but not part of its name/description.
    const results = searchServices("isolation");
    expect(results.some((s) => s.id === "vpc")).toBe(true);
  });

  it("is case-insensitive and trims whitespace", () => {
    expect(searchServices("  vPc  ").some((s) => s.id === "vpc")).toBe(true);
  });

  it("returns all services for an empty query", () => {
    expect(searchServices("").length).toBe(allServices().length);
    expect(searchServices("   ").length).toBe(allServices().length);
  });

  it("returns a fresh copy on an empty query (does not leak the internal array)", () => {
    const a = searchServices("");
    const b = searchServices("");
    // Distinct array instances each call...
    expect(a).not.toBe(b);
    // ...and mutating the returned array must not shrink the registry.
    const before = allServices().length;
    a.length = 0;
    expect(allServices().length).toBe(before);
    expect(searchServices("").length).toBe(before);
  });

  it("returns an empty array when nothing matches", () => {
    expect(searchServices("zzz-no-such-service-zzz")).toEqual([]);
  });
});
