import { describe, it, expect } from "vitest";
import { actionsToKind, planDiff, namespacePlanDiff, mergePlanDiffs } from "./planDiff";

describe("actionsToKind", () => {
  it("maps each Terraform action shape to a ChangeKind", () => {
    expect(actionsToKind(["no-op"])).toBe("noop");
    expect(actionsToKind(["create"])).toBe("create");
    expect(actionsToKind(["update"])).toBe("update");
    expect(actionsToKind(["delete"])).toBe("delete");
    expect(actionsToKind(["read"])).toBe("read");
    // Replace is the destroy/create pair, in either order.
    expect(actionsToKind(["delete", "create"])).toBe("replace");
    expect(actionsToKind(["create", "delete"])).toBe("replace");
  });
});

describe("planDiff", () => {
  const plan = {
    resource_changes: [
      { address: "aws_vpc.main", type: "aws_vpc", name: "main", change: { actions: ["no-op"] } },
      { address: "aws_subnet.a", type: "aws_subnet", name: "a", change: { actions: ["create"] } },
      { address: "aws_subnet.b", type: "aws_subnet", name: "b", change: { actions: ["update"] } },
      {
        address: "aws_instance.old",
        type: "aws_instance",
        name: "old",
        change: { actions: ["delete"] },
      },
      {
        address: "aws_db_instance.db",
        type: "aws_db_instance",
        name: "db",
        change: { actions: ["delete", "create"] },
      },
    ],
  };

  it("keys changes by resource address with the right kind", () => {
    const d = planDiff(plan);
    expect(d.changes["aws_subnet.a"]).toBe("create");
    expect(d.changes["aws_subnet.b"]).toBe("update");
    expect(d.changes["aws_instance.old"]).toBe("delete");
    expect(d.changes["aws_db_instance.db"]).toBe("replace");
    expect(d.changes["aws_vpc.main"]).toBe("noop");
  });

  it("tallies counts per kind", () => {
    const d = planDiff(plan);
    expect(d.counts).toMatchObject({ create: 1, update: 1, delete: 1, replace: 1, noop: 1 });
  });

  it("returns an empty diff for non-plan input instead of throwing", () => {
    expect(planDiff({}).changes).toEqual({});
    expect(planDiff(null).counts.create).toBe(0);
  });
});

describe("namespacePlanDiff / mergePlanDiffs", () => {
  it("prefixes change keys for a layer namespace", () => {
    const d = namespacePlanDiff(
      { changes: { "aws_vpc.main": "create" }, counts: planDiff({}).counts },
      "prod::",
    );
    expect(d.changes["prod::aws_vpc.main"]).toBe("create");
  });

  it("merges change maps and sums counts", () => {
    const a = planDiff({
      resource_changes: [{ address: "x", type: "t", change: { actions: ["create"] } }],
    });
    const b = planDiff({
      resource_changes: [{ address: "y", type: "t", change: { actions: ["delete"] } }],
    });
    const m = mergePlanDiffs([a, b]);
    expect(Object.keys(m.changes).sort()).toEqual(["x", "y"]);
    expect(m.counts.create).toBe(1);
    expect(m.counts.delete).toBe(1);
  });
});
