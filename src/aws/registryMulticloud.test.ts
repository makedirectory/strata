import { describe, it, expect } from "vitest";
import {
  getServiceByNativeType,
  getServiceByCfnType,
  serviceProvider,
  serviceNativeType,
  validateRegistry,
  allServices,
} from "./registry";

describe("multi-cloud resolver", () => {
  it("resolves AWS by CloudFormation type (unchanged behaviour)", () => {
    expect(getServiceByCfnType("AWS::EC2::VPC")?.id).toBe("vpc");
    expect(getServiceByNativeType("aws", "AWS::EC2::VPC")?.id).toBe("vpc");
  });

  it("resolves GCP by Cloud Asset Inventory type", () => {
    const svc = getServiceByNativeType("gcp", "compute.googleapis.com/Instance");
    expect(svc?.provider).toBe("gcp");
    expect(svc?.id).toBe("gcp-compute-engine");
  });

  it("resolves Azure by ARM type", () => {
    const svc = getServiceByNativeType("azure", "Microsoft.Compute/virtualMachines");
    expect(svc?.provider).toBe("azure");
    expect(svc?.id).toBe("azure-vm");
  });

  it("namespaces the join key by provider (no cross-provider bleed)", () => {
    // An AWS CFN type must not resolve under the gcp/azure namespace.
    expect(getServiceByNativeType("gcp", "AWS::EC2::VPC")).toBeUndefined();
    expect(getServiceByNativeType("azure", "AWS::EC2::VPC")).toBeUndefined();
  });

  it("treats provider-less AWS entries as provider 'aws'", () => {
    const vpc = allServices("aws").find((s) => s.id === "vpc")!;
    expect(serviceProvider(vpc)).toBe("aws");
    // AWS native type falls back to cfnType.
    expect(serviceNativeType(vpc)).toBe("AWS::EC2::VPC");
  });
});

describe("registry integrity with all three providers", () => {
  it("has no duplicate ids or unknown categories (errors)", () => {
    const errors = validateRegistry().filter((i) => i.level === "error");
    expect(errors).toEqual([]);
  });
});
