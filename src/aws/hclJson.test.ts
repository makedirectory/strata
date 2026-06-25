import { describe, it, expect } from "vitest";
import { importHclJson, type HclFile } from "./hclJson";

/** Hand-built hcl2json docs (the shape `@cdktf/hcl2json` emits). */
function root(): HclFile {
  return {
    path: "environments/prod/main.tf",
    doc: {
      module: {
        net: [{ source: "../../modules/networking" }],
        ext: [{ source: "terraform-aws-modules/vpc/aws" }], // non-local
      },
    },
  };
}

function netModule(): HclFile {
  return {
    path: "modules/networking/main.tf",
    doc: {
      resource: {
        aws_vpc: { main: [{ cidr_block: "${var.cidr}" }] },
        aws_subnet: {
          public: [{ for_each: "${var.subnets}", vpc_id: "${aws_vpc.main.id}" }],
        },
        aws_lambda_function: {
          worker: [{ role: "${aws_iam_role.flow.arn}" }],
        },
        aws_iam_role: { flow: [{ name: "flow" }] },
      },
    },
  };
}

describe("importHclJson", () => {
  it("expands local modules inline with Terraform-style addresses", () => {
    const r = importHclJson([root(), netModule()], "environments/prod");
    const ids = r.graph.resources.map((x) => x.id).sort();
    expect(ids).toContain("module.net.aws_vpc.main");
    expect(ids).toContain("module.net.aws_subnet.public");
  });

  it("resolves containment refs (vpc_id) to a parent within the same module scope", () => {
    const r = importHclJson([root(), netModule()], "environments/prod");
    const subnet = r.graph.resources.find((x) => x.id === "module.net.aws_subnet.public");
    expect(subnet?.parentId).toBe("module.net.aws_vpc.main");
  });

  it("turns non-containment resource refs into depends_on edges", () => {
    const r = importHclJson([root(), netModule()], "environments/prod");
    const edge = r.graph.relationships.find(
      (e) =>
        e.from === "module.net.aws_lambda_function.worker" &&
        e.to === "module.net.aws_iam_role.flow",
    );
    expect(edge?.kind).toBe("depends_on");
  });

  it("does not mistake var./local./module. interpolations for resource refs", () => {
    const r = importHclJson([root(), netModule()], "environments/prod");
    const vpc = r.graph.resources.find((x) => x.id === "module.net.aws_vpc.main");
    // cidr_block = "${var.cidr}" must not create an edge.
    expect(r.graph.relationships.filter((e) => e.from === vpc?.id)).toHaveLength(0);
  });

  it("warns about non-local (registry/git) module sources and for_each", () => {
    const r = importHclJson([root(), netModule()], "environments/prod");
    expect(r.warnings.some((w) => /not expanded/.test(w))).toBe(true);
    expect(r.warnings.some((w) => /for_each/.test(w))).toBe(true);
  });

  it("reports unmapped resource types instead of throwing", () => {
    const f: HclFile = {
      path: "main.tf",
      doc: { resource: { some_unknown_thing: { x: [{}] } } },
    };
    const r = importHclJson([f], "");
    expect(r.unmappedTypes).toContain("some_unknown_thing");
    expect(r.graph.resources).toHaveLength(0);
  });
});
