import { describe, it, expect } from "vitest";
import {
  importArm,
  exportArm,
  isArmTemplate,
  importAzureTerraform,
  exportAzureTerraform,
  AZURE_TF_TYPE_TO_SERVICE_ID,
} from "./iac";
import { getService } from "../aws/registry";

const armTemplate = {
  $schema: "https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#",
  contentVersion: "1.0.0.0",
  parameters: { location: { type: "string", defaultValue: "eastus" } },
  resources: [
    {
      type: "Microsoft.Network/virtualNetworks",
      apiVersion: "2023-05-01",
      name: "vnet1",
      location: "[parameters('location')]",
      properties: { addressSpace: { addressPrefixes: ["10.0.0.0/16"] } },
    },
    {
      type: "Microsoft.Sql/servers",
      apiVersion: "2022-05-01",
      name: "sql1",
      properties: { administratorLogin: "admin" },
    },
    {
      type: "Microsoft.Sql/servers/databases",
      apiVersion: "2022-05-01",
      name: "sql1/db1",
      dependsOn: ["[resourceId('Microsoft.Sql/servers', 'sql1')]"],
      properties: { sku: { name: "S0" } },
    },
  ],
  outputs: {
    vnetId: { type: "string", value: "[resourceId('Microsoft.Network/virtualNetworks','vnet1')]" },
  },
};

describe("ARM detection + import", () => {
  it("recognises an ARM template", () => {
    expect(isArmTemplate(armTemplate)).toBe(true);
    expect(isArmTemplate({ Resources: {} })).toBe(false);
  });

  it("maps ARM types to Azure services", () => {
    const { graph, unmappedTypes } = importArm(armTemplate);
    expect(unmappedTypes).toEqual([]);
    expect(graph.resources).toHaveLength(3);
    for (const r of graph.resources) {
      expect(getService(r.serviceId)?.provider).toBe("azure");
    }
  });

  it("nests a child resource (server/database) under its parent", () => {
    const { graph } = importArm(armTemplate);
    const db = graph.resources.find((r) => r.serviceId === "azure-sql-database");
    const server = graph.resources.find((r) => r.serviceId === "azure-sql-server");
    expect(db?.parentId).toBe(server?.id);
  });

  it("captures template sections for faithful re-emit", () => {
    const { graph } = importArm(armTemplate);
    expect(graph.iacSource?.format).toBe("arm");
    expect(graph.iacSource?.parameters).toBeDefined();
    expect(graph.iacSource?.outputs).toBeDefined();
  });
});

describe("ARM export round-trip", () => {
  it("re-emits a faithful template (types + properties + sections preserved)", () => {
    const { graph } = importArm(armTemplate);
    const { json, report } = exportArm(graph);
    const out = JSON.parse(json);
    // Faithful path used for every imported resource.
    expect(report.faithful).toBe(3);
    const types = out.resources.map((r: { type: string }) => r.type).sort();
    expect(types).toEqual([
      "Microsoft.Network/virtualNetworks",
      "Microsoft.Sql/servers",
      "Microsoft.Sql/servers/databases",
    ]);
    // Properties survive verbatim.
    const vnet = out.resources.find(
      (r: { type: string }) => r.type === "Microsoft.Network/virtualNetworks",
    );
    expect(vnet.properties.addressSpace.addressPrefixes).toEqual(["10.0.0.0/16"]);
    // Sections survive.
    expect(out.parameters).toBeDefined();
    expect(out.outputs).toBeDefined();
  });
});

describe("Azure Terraform (azurerm)", () => {
  const tf = {
    values: {
      root_module: {
        resources: [
          {
            address: "azurerm_resource_group.rg",
            type: "azurerm_resource_group",
            name: "rg",
            values: { id: "rg-1", name: "my-rg" },
          },
          {
            address: "azurerm_storage_account.sa",
            type: "azurerm_storage_account",
            name: "sa",
            values: { id: "sa-1", name: "mystorage" },
          },
        ],
      },
    },
  };

  it("imports azurerm_* types and exports them back", () => {
    const { graph, unmappedTypes } = importAzureTerraform(tf);
    expect(unmappedTypes).toEqual([]);
    expect(graph.resources).toHaveLength(2);
    const { hcl } = exportAzureTerraform(graph);
    expect(hcl).toContain('resource "azurerm_resource_group"');
    expect(hcl).toContain('resource "azurerm_storage_account"');
  });

  it("type map only references real service ids", () => {
    for (const serviceId of Object.values(AZURE_TF_TYPE_TO_SERVICE_ID)) {
      expect(getService(serviceId), `missing service ${serviceId}`).toBeDefined();
    }
  });
});
