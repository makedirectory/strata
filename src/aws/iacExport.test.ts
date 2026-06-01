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

describe("iacExport — cfnPropertyNames rename (scaffold path)", () => {
  it("renames modeled keys to provider-native CFN property names", () => {
    // A manually-built rds resource with NO raw/iacSource takes the scaffold
    // path, where applyPropertyNames maps storageEncrypted/publiclyAccessible.
    const g = emptyGraph("Rename");
    g.resources = [
      res("r-db", "rds", {
        name: "primary",
        config: { storageEncrypted: true, publiclyAccessible: false },
      }),
    ];
    const { json, report } = exportCloudFormation(g);
    const parsed = JSON.parse(json) as Record<string, any>;
    const entry = Object.values(parsed.Resources)[0] as any;

    // Scaffold (not faithful) — confirms we exercised the rename path.
    expect(report.faithful).toBe(0);
    expect(entry.Type).toBe("AWS::RDS::DBInstance");
    // Emitted under the renamed keys, NOT the modeled keys.
    expect(entry.Properties.StorageEncrypted).toBe(true);
    expect(entry.Properties.PubliclyAccessible).toBe(false);
    expect(entry.Properties).not.toHaveProperty("storageEncrypted");
    expect(entry.Properties).not.toHaveProperty("publiclyAccessible");
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

describe("iacExport — S3 scaffold transform", () => {
  it("emits nested versioning/encryption and a separate BucketPublicAccessBlock", () => {
    const g = emptyGraph("S3");
    g.resources = [
      res("r-s3", "s3-bucket", {
        name: "assets",
        config: {
          bucketName: "my-bucket",
          versioning: true,
          encryption: "SSE-KMS",
          blockPublicAccess: true,
        },
      }),
    ];
    const { json } = exportCloudFormation(g);
    const parsed = JSON.parse(json) as Record<string, any>;
    const byType: Record<string, any> = {};
    for (const entry of Object.values(parsed.Resources)) byType[(entry as any).Type] = entry;

    const bucket = byType["AWS::S3::Bucket"];
    expect(bucket.Properties.BucketName).toBe("my-bucket");
    expect(bucket.Properties.VersioningConfiguration).toEqual({ Status: "Enabled" });
    expect(
      bucket.Properties.BucketEncryption.ServerSideEncryptionConfiguration[0]
        .ServerSideEncryptionByDefault.SSEAlgorithm,
    ).toBe("aws:kms");
    // Strata's raw config keys must NOT leak into the template.
    expect(bucket.Properties.versioning).toBeUndefined();
    expect(bucket.Properties.blockPublicAccess).toBeUndefined();

    // Block Public Access is a separate resource that Refs + DependsOn the bucket.
    const bucketLogicalId = Object.keys(parsed.Resources).find(
      (k) => parsed.Resources[k].Type === "AWS::S3::Bucket",
    );
    const pab = byType["AWS::S3::BucketPublicAccessBlock"];
    expect(pab).toBeDefined();
    expect(pab.Properties.Bucket).toEqual({ Ref: bucketLogicalId });
    expect(pab.Properties.PublicAccessBlockConfiguration).toEqual({
      BlockPublicAcls: true,
      BlockPublicPolicy: true,
      IgnorePublicAcls: true,
      RestrictPublicBuckets: true,
    });
    expect(pab.DependsOn).toEqual([bucketLogicalId]);
  });

  it("does not emit a PublicAccessBlock when blockPublicAccess is unset", () => {
    const g = emptyGraph("S3");
    g.resources = [res("r-s3", "s3-bucket", { name: "assets", config: { versioning: false } })];
    const { json } = exportCloudFormation(g);
    const parsed = JSON.parse(json) as Record<string, any>;
    const types = Object.values(parsed.Resources).map((e) => (e as any).Type);
    expect(types).not.toContain("AWS::S3::BucketPublicAccessBlock");
    const byType: Record<string, any> = {};
    for (const entry of Object.values(parsed.Resources)) byType[(entry as any).Type] = entry;
    expect(byType["AWS::S3::Bucket"].Properties.VersioningConfiguration).toEqual({
      Status: "Suspended",
    });
  });
});

describe("iacExport — S3 secure-config (KMS key + object ownership)", () => {
  const kmsBucket = () => {
    const g = emptyGraph("S3");
    g.resources = [
      res("r-s3", "s3-bucket", {
        name: "secure",
        config: {
          bucketName: "secure-bucket",
          encryption: "SSE-KMS",
          kmsKeyId: "arn:aws:kms:us-east-1:111122223333:key/abc-123",
          objectOwnership: "BucketOwnerEnforced",
        },
      }),
    ];
    return g;
  };

  it("CloudFormation: emits customer KMS key, BucketKeyEnabled, and OwnershipControls", () => {
    const { json } = exportCloudFormation(kmsBucket());
    const parsed = JSON.parse(json) as Record<string, any>;
    const bucket = Object.values(parsed.Resources).find(
      (e) => (e as any).Type === "AWS::S3::Bucket",
    ) as any;
    const rule = bucket.Properties.BucketEncryption.ServerSideEncryptionConfiguration[0];
    expect(rule.ServerSideEncryptionByDefault.SSEAlgorithm).toBe("aws:kms");
    expect(rule.ServerSideEncryptionByDefault.KMSMasterKeyID).toBe(
      "arn:aws:kms:us-east-1:111122223333:key/abc-123",
    );
    expect(rule.BucketKeyEnabled).toBe(true);
    expect(bucket.Properties.OwnershipControls).toEqual({
      Rules: [{ ObjectOwnership: "BucketOwnerEnforced" }],
    });
  });

  it("Terraform: emits kms_master_key_id, bucket_key_enabled, and an ownership-controls resource", () => {
    const { hcl } = exportTerraform(kmsBucket());
    expect(hcl).toContain('kms_master_key_id = "arn:aws:kms:us-east-1:111122223333:key/abc-123"');
    expect(hcl).toContain("bucket_key_enabled = true");
    expect(hcl).toContain('resource "aws_s3_bucket_ownership_controls" "secure_ownership"');
    expect(hcl).toContain('object_ownership = "BucketOwnerEnforced"');
    expect(hcl).toContain("bucket = aws_s3_bucket.secure.id");
  });

  it("does not add a KMS key or BucketKeyEnabled for SSE-S3", () => {
    const g = emptyGraph("S3");
    g.resources = [res("r-s3", "s3-bucket", { name: "plain", config: { encryption: "SSE-S3" } })];
    const { json } = exportCloudFormation(g);
    const parsed = JSON.parse(json) as Record<string, any>;
    const bucket = Object.values(parsed.Resources).find(
      (e) => (e as any).Type === "AWS::S3::Bucket",
    ) as any;
    const rule = bucket.Properties.BucketEncryption.ServerSideEncryptionConfiguration[0];
    expect(rule.ServerSideEncryptionByDefault.SSEAlgorithm).toBe("AES256");
    expect(rule.ServerSideEncryptionByDefault.KMSMasterKeyID).toBeUndefined();
    expect(rule.BucketKeyEnabled).toBeUndefined();
  });
});

describe("iacExport — route53 record/zone round-trip", () => {
  it("keeps hosted zones and records as distinct Terraform types", () => {
    expect(SERVICE_ID_TO_TF_TYPE["route53"]).toBe("aws_route53_zone");
    expect(SERVICE_ID_TO_TF_TYPE["route53-record"]).toBe("aws_route53_record");
  });
});

describe("iacExport — S3 Terraform transform", () => {
  it("splits versioning/encryption/public-access into separate resources", () => {
    const g = emptyGraph("S3");
    g.resources = [
      res("r-s3", "s3-bucket", {
        name: "assets",
        config: {
          bucketName: "my-bucket",
          versioning: true,
          encryption: "SSE-KMS",
          blockPublicAccess: true,
        },
      }),
    ];
    const { hcl, report } = exportTerraform(g);

    expect(hcl).toContain('resource "aws_s3_bucket" "assets"');
    expect(hcl).toContain('bucket = "my-bucket"');
    expect(hcl).toContain('resource "aws_s3_bucket_versioning" "assets_versioning"');
    expect(hcl).toContain('status = "Enabled"');
    expect(hcl).toContain(
      'resource "aws_s3_bucket_server_side_encryption_configuration" "assets_encryption"',
    );
    expect(hcl).toContain('sse_algorithm = "aws:kms"');
    expect(hcl).toContain(
      'resource "aws_s3_bucket_public_access_block" "assets_public_access_block"',
    );
    expect(hcl).toContain("restrict_public_buckets = true");
    // Aux resources reference the bucket as an unquoted HCL expression (implicit
    // dependency), not a quoted string.
    expect(hcl).toContain("bucket = aws_s3_bucket.assets.id");
    // Strata's raw config keys must not leak into the HCL.
    expect(hcl).not.toContain("versioning = true");
    expect(hcl).not.toContain("blockPublicAccess");
    // Primary bucket + 3 auxiliary resources.
    expect(report.exported).toBe(4);
    // Balanced braces — cheap structural sanity check.
    expect((hcl.match(/{/g) ?? []).length).toBe((hcl.match(/}/g) ?? []).length);
  });

  it("emits no auxiliary resources when secure config is unset", () => {
    const g = emptyGraph("S3");
    g.resources = [res("r-s3", "s3-bucket", { name: "assets", config: {} })];
    const { hcl, report } = exportTerraform(g);
    expect(hcl).toContain('resource "aws_s3_bucket" "assets"');
    expect(hcl).not.toContain("aws_s3_bucket_versioning");
    expect(hcl).not.toContain("aws_s3_bucket_public_access_block");
    expect(report.exported).toBe(1);
  });
});
