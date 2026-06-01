import { describe, it, expect } from "vitest";
import {
  importArm,
  exportArm,
  isArmTemplate,
  importAzureTerraform,
  exportAzureTerraform,
  AZURE_TF_TYPE_TO_SERVICE_ID,
} from "./iac";
import { getService, getServiceByNativeType } from "../aws/registry";

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

  it("maps ARM types to Azure services and reports format 'arm'", () => {
    const result = importArm(armTemplate);
    expect(result.format).toBe("arm");
    expect(result.unmappedTypes).toEqual([]);
    expect(result.graph.resources).toHaveLength(3);
    for (const r of result.graph.resources) {
      expect(getService(r.serviceId)?.provider).toBe("azure");
    }
  });

  it("gives cross-type duplicate names distinct ids (valid graph) and warns", () => {
    // A VNet and a Storage Account that happen to share the name "shared".
    const dupes = {
      resources: [
        { type: "Microsoft.Network/virtualNetworks", name: "shared", properties: {} },
        { type: "Microsoft.Storage/storageAccounts", name: "shared", properties: {} },
      ],
    };
    const { graph, warnings } = importArm(dupes);
    expect(graph.resources).toHaveLength(2);
    expect(new Set(graph.resources.map((r) => r.id)).size).toBe(2);
    expect(warnings.some((w) => w.includes("Duplicate ARM resource name"))).toBe(true);
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

  it("maps the newly added azurerm_* types to the right service ids", () => {
    const expected: Record<string, string> = {
      azurerm_service_plan: "azure-app-service-plan",
      azurerm_app_service_plan: "azure-app-service-plan",
      azurerm_container_registry: "azure-container-registry",
      azurerm_network_interface: "azure-network-interface",
      azurerm_private_endpoint: "azure-private-endpoint",
      azurerm_mysql_flexible_server: "azure-mysql",
      azurerm_mssql_managed_instance: "azure-sql-managed-instance",
    };
    for (const [tfType, serviceId] of Object.entries(expected)) {
      expect(AZURE_TF_TYPE_TO_SERVICE_ID[tfType], `${tfType} mapping`).toBe(serviceId);
    }
  });

  it("resolves new services by their ARM nativeType", () => {
    const expected: Record<string, string> = {
      "Microsoft.Web/serverfarms": "azure-app-service-plan",
      "Microsoft.ContainerRegistry/registries": "azure-container-registry",
      "Microsoft.Network/networkInterfaces": "azure-network-interface",
      "Microsoft.Network/privateEndpoints": "azure-private-endpoint",
      "Microsoft.DBforMySQL/flexibleServers": "azure-mysql",
      "Microsoft.Sql/managedInstances": "azure-sql-managed-instance",
    };
    for (const [nativeType, serviceId] of Object.entries(expected)) {
      expect(getServiceByNativeType("azure", nativeType)?.id, `${nativeType} lookup`).toBe(
        serviceId,
      );
    }
  });

  it("nests a subnet under its vnet via virtual_network_id", () => {
    const vnetId =
      "/subscriptions/s/resourceGroups/rg/providers/Microsoft.Network/virtualNetworks/vnet1";
    const containment = {
      values: {
        root_module: {
          resources: [
            {
              address: "azurerm_virtual_network.vnet",
              type: "azurerm_virtual_network",
              name: "vnet",
              values: { id: vnetId, name: "vnet1" },
            },
            {
              address: "azurerm_subnet.sub",
              type: "azurerm_subnet",
              name: "sub",
              values: { id: "sub-1", name: "subnet1", virtual_network_id: vnetId },
            },
          ],
        },
      },
    };
    const { graph } = importAzureTerraform(containment);
    const vnet = graph.resources.find((r) => r.serviceId === "azure-vnet");
    const subnet = graph.resources.find((r) => r.serviceId === "azure-subnet");
    expect(subnet?.parentId).toBe(vnet?.id);
  });

  it("imports a plan-shaped (resource_changes) storage account", () => {
    const plan = {
      resource_changes: [
        {
          address: "azurerm_storage_account.sa",
          type: "azurerm_storage_account",
          change: { after: { id: "sa-1", name: "mystorage" } },
        },
      ],
    };
    const { graph, unmappedTypes } = importAzureTerraform(plan);
    expect(unmappedTypes).toEqual([]);
    expect(graph.resources).toHaveLength(1);
    expect(graph.resources[0].serviceId).toBe("azure-storage-account");
  });
});

describe("ARM Microsoft.Web/sites disambiguation", () => {
  it("resolves kind 'functionapp' to azure-functions", () => {
    const { graph } = importArm({
      resources: [
        {
          type: "Microsoft.Web/sites",
          name: "fn1",
          kind: "functionapp",
          properties: {},
        },
      ],
    });
    expect(graph.resources).toHaveLength(1);
    expect(graph.resources[0].serviceId).toBe("azure-functions");
  });

  it("resolves kind 'app' (or none) to azure-app-service", () => {
    const kindApp = importArm({
      resources: [{ type: "Microsoft.Web/sites", name: "web1", kind: "app", properties: {} }],
    });
    expect(kindApp.graph.resources[0].serviceId).toBe("azure-app-service");

    const noKind = importArm({
      resources: [{ type: "Microsoft.Web/sites", name: "web2", properties: {} }],
    });
    expect(noKind.graph.resources[0].serviceId).toBe("azure-app-service");
  });
});
