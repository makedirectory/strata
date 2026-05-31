import { describe, it, expect } from "vitest";
import { importCloudFormation } from "./iac";
import { exportCloudFormation } from "./iacExport";

// A template whose resource types Strata models, exercising intrinsics + sections.
const template = {
  AWSTemplateFormatVersion: "2010-09-09",
  Description: "fidelity fixture",
  Parameters: { Env: { Type: "String", Default: "prod" } },
  Conditions: { IsProd: { "Fn::Equals": [{ Ref: "Env" }, "prod"] } },
  Resources: {
    Vpc: { Type: "AWS::EC2::VPC", Properties: { CidrBlock: "10.0.0.0/16" } },
    Subnet: {
      Type: "AWS::EC2::Subnet",
      Properties: { VpcId: { Ref: "Vpc" }, CidrBlock: "10.0.1.0/24" },
    },
    Bucket: {
      Type: "AWS::S3::Bucket",
      Condition: "IsProd",
      Properties: { BucketName: { "Fn::Sub": "assets-${Env}" } },
    },
  },
  Outputs: { VpcId: { Value: { Ref: "Vpc" } } },
};

describe("CloudFormation lossless sidecar", () => {
  it("captures raw source per resource and template sections on import", () => {
    const { graph } = importCloudFormation(template);
    const bucket = graph.resources.find((r) => r.serviceId === "s3-bucket");
    expect(bucket?.raw?.format).toBe("cloudformation");
    expect(bucket?.raw?.type).toBe("AWS::S3::Bucket");
    expect(bucket?.raw?.condition).toBe("IsProd");
    // Intrinsic functions are preserved verbatim (not interpreted).
    expect(bucket?.raw?.properties?.BucketName).toEqual({ "Fn::Sub": "assets-${Env}" });
    expect(graph.iacSource?.parameters).toBeDefined();
    expect(graph.iacSource?.conditions).toBeDefined();
    expect(graph.iacSource?.outputs).toBeDefined();
  });

  it("re-emits a FAITHFUL template: types, intrinsics and sections survive a round trip", () => {
    const { graph } = importCloudFormation(template);
    const { json, report } = exportCloudFormation(graph);
    const out = JSON.parse(json);

    // Every modeled resource re-emitted faithfully (no scaffolding).
    expect(report.faithful).toBe(report.exported);
    expect(report.exported).toBe(3);

    // Resource types preserved.
    const types = Object.values(out.Resources).map((r: unknown) => (r as { Type: string }).Type);
    expect(types.sort()).toEqual(["AWS::EC2::Subnet", "AWS::EC2::VPC", "AWS::S3::Bucket"]);

    // Intrinsic functions preserved verbatim.
    expect(out.Resources.Bucket.Properties.BucketName).toEqual({ "Fn::Sub": "assets-${Env}" });
    expect(out.Resources.Subnet.Properties.VpcId).toEqual({ Ref: "Vpc" });
    // Resource-level Condition preserved.
    expect(out.Resources.Bucket.Condition).toBe("IsProd");

    // Template sections round-trip.
    expect(out.Parameters).toEqual(template.Parameters);
    expect(out.Conditions).toEqual(template.Conditions);
    expect(out.Outputs).toEqual(template.Outputs);
  });

  it("re-importing the exported template yields a structurally identical graph", () => {
    const first = importCloudFormation(template).graph;
    const { json } = exportCloudFormation(first);
    const second = importCloudFormation(JSON.parse(json)).graph;
    expect(second.resources.map((r) => r.serviceId).sort()).toEqual(
      first.resources.map((r) => r.serviceId).sort(),
    );
    expect(second.relationships.length).toBe(first.relationships.length);
  });
});
