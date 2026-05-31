import { describe, it, expect } from "vitest";
import { importAnyIaC } from "./importIac";
import { getService, serviceProvider } from "../aws/registry";

const providersOf = (graph: { resources: { serviceId: string }[] }) =>
  new Set(graph.resources.map((r) => serviceProvider(getService(r.serviceId)!)));

describe("importAnyIaC — multi-cloud routing", () => {
  it("routes AWS CloudFormation (JSON) and keeps the cloudformation format", () => {
    const cfn = JSON.stringify({
      Resources: { Vpc: { Type: "AWS::EC2::VPC", Properties: { CidrBlock: "10.0.0.0/16" } } },
    });
    const r = importAnyIaC(cfn);
    expect(r.format).toBe("cloudformation");
    expect(providersOf(r.graph)).toEqual(new Set(["aws"]));
  });

  it("routes AWS CloudFormation YAML", () => {
    const yaml = `Resources:\n  Bucket:\n    Type: AWS::S3::Bucket\n`;
    const r = importAnyIaC(yaml);
    expect(r.format).toBe("cloudformation");
    expect(r.graph.resources).toHaveLength(1);
  });

  it("routes an Azure ARM template", () => {
    const arm = JSON.stringify({
      $schema: "https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#",
      contentVersion: "1.0.0.0",
      resources: [{ type: "Microsoft.Compute/virtualMachines", name: "vm1", properties: {} }],
    });
    const r = importAnyIaC(arm);
    expect(r.format).toBe("arm");
    expect(providersOf(r.graph)).toEqual(new Set(["azure"]));
  });

  it("routes GCP Terraform (google_*) via the merged type map", () => {
    const tf = JSON.stringify({
      values: {
        root_module: {
          resources: [
            {
              address: "google_storage_bucket.b",
              type: "google_storage_bucket",
              name: "b",
              values: { id: "b" },
            },
          ],
        },
      },
    });
    const r = importAnyIaC(tf);
    expect(r.format).toBe("terraform");
    expect(providersOf(r.graph)).toEqual(new Set(["gcp"]));
  });

  it("routes Azure Terraform (azurerm_*) via the merged type map", () => {
    const tf = JSON.stringify({
      values: {
        root_module: {
          resources: [
            {
              address: "azurerm_storage_account.s",
              type: "azurerm_storage_account",
              name: "s",
              values: { id: "s" },
            },
          ],
        },
      },
    });
    const r = importAnyIaC(tf);
    expect(r.format).toBe("terraform");
    expect(providersOf(r.graph)).toEqual(new Set(["azure"]));
  });

  it("resolves a mixed-provider Terraform state into one graph", () => {
    const tf = JSON.stringify({
      values: {
        root_module: {
          resources: [
            { address: "aws_s3_bucket.a", type: "aws_s3_bucket", name: "a", values: { id: "a" } },
            {
              address: "google_storage_bucket.g",
              type: "google_storage_bucket",
              name: "g",
              values: { id: "g" },
            },
          ],
        },
      },
    });
    const r = importAnyIaC(tf);
    expect(providersOf(r.graph)).toEqual(new Set(["aws", "gcp"]));
  });
});
