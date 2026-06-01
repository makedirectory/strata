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

describe("gcp/azure secure defaults", () => {
  const gcp = (id: string) => allServices("gcp").find((s) => s.id === id)!;
  const azure = (id: string) => allServices("azure").find((s) => s.id === id)!;
  const def = (svc: { configFields: { key: string; default?: unknown }[] }, key: string) =>
    svc.configFields.find((f) => f.key === key)?.default;

  it("gcp-cloud-run blocks unauthenticated access by default", () => {
    expect(def(gcp("gcp-cloud-run"), "allowUnauthenticated")).toBe(false);
  });

  it("gcp-cloud-storage enforces uniform/private access by default", () => {
    const svc = gcp("gcp-cloud-storage");
    expect(def(svc, "uniformBucketLevelAccess")).toBe(true);
    expect(def(svc, "publicAccessPrevention")).toBe("enforced");
  });

  it("gcp-cloud-sql requires SSL and disables public IPv4 by default", () => {
    const svc = gcp("gcp-cloud-sql");
    expect(def(svc, "requireSsl")).toBe(true);
    expect(def(svc, "ipv4Enabled")).toBe(false);
  });

  it("azure-storage-account is private/HTTPS-only with TLS 1.2 by default", () => {
    const svc = azure("azure-storage-account");
    expect(def(svc, "allowPublicAccess")).toBe(false);
    expect(def(svc, "supportsHttpsTrafficOnly")).toBe(true);
    expect(def(svc, "minimumTlsVersion")).toBe("TLS1_2");
  });

  it("azure-redis disables the non-SSL port by default", () => {
    expect(def(azure("azure-redis"), "enableNonSslPort")).toBe(false);
  });

  it("azure-app-service is HTTPS-only by default", () => {
    expect(def(azure("azure-app-service"), "httpsOnly")).toBe(true);
  });

  it("azure-sql-server disables public network access by default", () => {
    expect(def(azure("azure-sql-server"), "publicNetworkAccess")).toBe("Disabled");
  });

  it("azure-sql-database enables transparent data encryption by default", () => {
    expect(def(azure("azure-sql-database"), "transparentDataEncryption")).toBe(true);
  });
});
