import { describe, it, expect } from "vitest";
import yaml from "js-yaml";
import { emptyGraph, type InfrastructureGraph, type ResourceInstance } from "./model";
import type { RelationshipKind } from "./types";
import { SERVICES, getService } from "./registry";
import { TF_TYPE_TO_SERVICE_ID, importIaC } from "./iac";
import {
  exportCloudFormation,
  exportTerraform,
  exportIaC,
  SERVICE_ID_TO_TF_TYPE,
} from "./iacExport";

/** Minimal resource builder for tests. */
function res(
  id: string,
  serviceId: string,
  extra: Partial<ResourceInstance> = {},
): ResourceInstance {
  return {
    id,
    serviceId,
    name: id,
    config: {},
    source: "manual",
    ...extra,
  };
}

/** A flat graph of cleanly round-tripping services with two dependencies. */
function sampleGraph(): InfrastructureGraph {
  const g = emptyGraph("Sample");
  g.resources = [
    res("r-vpc", "vpc", { name: "main-vpc", config: { cidr: "10.0.0.0/16" } }),
    res("r-ec2", "ec2-instance", { name: "web" }),
    res("r-s3", "s3-bucket", { name: "assets" }),
    res("r-lambda", "lambda", { name: "worker" }),
  ];
  const rel = (from: string, to: string, kind: RelationshipKind) => ({
    id: `${from}-${to}`,
    from,
    to,
    kind,
    source: "manual" as const,
  });
  g.relationships = [rel("r-ec2", "r-vpc", "depends_on"), rel("r-lambda", "r-s3", "reads_from")];
  return g;
}

describe("iacExport — CloudFormation", () => {
  it("emits a valid template with correct Types and DependsOn (JSON)", () => {
    const { json } = exportCloudFormation(sampleGraph());
    const parsed = JSON.parse(json) as Record<string, any>;
    expect(parsed.AWSTemplateFormatVersion).toBe("2010-09-09");

    const byType: Record<string, any> = {};
    for (const entry of Object.values(parsed.Resources)) byType[(entry as any).Type] = entry;
    expect(Object.keys(byType).sort()).toEqual(
      ["AWS::EC2::Instance", "AWS::EC2::VPC", "AWS::Lambda::Function", "AWS::S3::Bucket"].sort(),
    );
    // The VPC's known config survives under its registry key.
    expect(byType["AWS::EC2::VPC"].Properties.cidr).toBe("10.0.0.0/16");
    // ec2 depends on the vpc (its only edge).
    expect(byType["AWS::EC2::Instance"].DependsOn).toHaveLength(1);
  });

  it("produces YAML that parses to the same structure", () => {
    const { json, yaml: y } = exportCloudFormation(sampleGraph());
    expect(yaml.load(y)).toEqual(JSON.parse(json));
  });

  it("is deterministic (same graph → identical output)", () => {
    expect(exportCloudFormation(sampleGraph()).json).toBe(exportCloudFormation(sampleGraph()).json);
  });
});

describe("iacExport — Terraform", () => {
  it("emits parseable-looking HCL with correct types and depends_on", () => {
    const { hcl } = exportTerraform(sampleGraph());
    expect(hcl).toContain('resource "aws_vpc" "main-vpc"');
    expect(hcl).toContain('resource "aws_instance" "web"');
    expect(hcl).toContain('resource "aws_s3_bucket" "assets"');
    expect(hcl).toContain('resource "aws_lambda_function" "worker"');
    expect(hcl).toContain('cidr = "10.0.0.0/16"');
    // ec2 depends on the vpc address.
    expect(hcl).toMatch(/depends_on = \[aws_vpc\.main-vpc\]/);
    // balanced braces — a cheap structural sanity check.
    expect((hcl.match(/{/g) ?? []).length).toBe((hcl.match(/}/g) ?? []).length);
  });
});

describe("iacExport — ExportReport (honesty surface)", () => {
  it("skips resources with no target type and records them, without crashing", () => {
    const g = emptyGraph("Mixed");
    g.resources = [res("r1", "lambda"), res("r-bogus", "totally-not-a-service")];

    const cfn = exportCloudFormation(g);
    expect(cfn.report.exported).toBe(1);
    expect(cfn.report.skipped.map((s) => s.id)).toEqual(["r-bogus"]);
    expect(cfn.json).not.toContain("totally-not-a-service");

    const tf = exportTerraform(g);
    expect(tf.report.exported).toBe(1);
    expect(tf.report.skipped.map((s) => s.id)).toEqual(["r-bogus"]);
  });

  it("records required-but-missing fields as TODOs (placeholder in output)", () => {
    // Find a service with a required config field — robust to registry changes.
    const svc = SERVICES.find((s) => s.cfnType && s.configFields.some((f) => f.required));
    expect(svc, "expected at least one service with a required config field").toBeTruthy();
    const requiredKey = svc!.configFields.find((f) => f.required)!.key;

    const g = emptyGraph("Todo");
    g.resources = [res("r1", svc!.id, { config: {} })];
    const { json, report } = exportCloudFormation(g);

    expect(report.todos.some((t) => t.field === requiredKey)).toBe(true);
    expect(json).toContain("TODO");
  });
});

describe("iacExport — inverse Terraform type map", () => {
  it("every imported serviceId has a single canonical TF type that maps back", () => {
    for (const serviceId of new Set(Object.values(TF_TYPE_TO_SERVICE_ID))) {
      const tfType = SERVICE_ID_TO_TF_TYPE[serviceId];
      expect(tfType, `no inverse TF type for "${serviceId}"`).toBeTruthy();
      // The chosen canonical type must itself map back to this serviceId.
      expect(TF_TYPE_TO_SERVICE_ID[tfType]).toBe(serviceId);
    }
  });

  it("picks the first-listed Terraform type for many-to-one services", () => {
    // elastic-load-balancer is imported from aws_lb / aws_alb / aws_elb.
    expect(SERVICE_ID_TO_TF_TYPE["elastic-load-balancer"]).toBe("aws_lb");
  });
});

describe("iacExport — round-trip stability (CloudFormation)", () => {
  it("preserves resource types and edge structure through export → import", () => {
    const g = sampleGraph();
    const { json } = exportCloudFormation(g);
    const { graph: round } = importIaC(json);

    // Same set of service types survives (these all resolve uniquely by cfnType).
    expect(round.resources.map((r) => r.serviceId).sort()).toEqual(
      g.resources.map((r) => r.serviceId).sort(),
    );

    // Edge structure (from→to, by serviceId) survives — kinds may coarsen to
    // depends_on, which is the documented lossy delta.
    const svcOf = (graph: InfrastructureGraph, id: string) =>
      graph.resources.find((r) => r.id === id)?.serviceId;
    const pairs = (graph: InfrastructureGraph) =>
      graph.relationships.map((e) => `${svcOf(graph, e.from)}→${svcOf(graph, e.to)}`).sort();

    expect(pairs(round)).toEqual(pairs(g));
  });
});

describe("iacExport — exportIaC convenience", () => {
  it("returns content + filename + report per format", () => {
    const g = sampleGraph();
    expect(exportIaC(g, "cloudformation-json").filename).toBe("strata-template.json");
    expect(exportIaC(g, "cloudformation-yaml").filename).toBe("strata-template.yaml");
    const tf = exportIaC(g, "terraform");
    expect(tf.filename).toBe("strata.tf");
    expect(tf.report.exported).toBe(4);
  });
});
