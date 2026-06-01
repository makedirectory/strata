/**
 * Azure Management & Governance service catalog.
 * Carries the Resource Group — Azure's mandatory regional container that groups
 * resources for lifecycle, access control and billing. Modeled as a container
 * (`isContainer: true`, scope "resource-group"); containment of children is
 * expressed via parentId at the model layer, so connections stay minimal.
 */
import type { ServiceDefinition } from "../../aws/types";

const management: ServiceDefinition[] = [
  {
    id: "azure-resource-group",
    name: "Resource Group",
    fullName: "Azure Resource Group",
    abbreviation: "RG",
    provider: "azure",
    category: "management",
    description: "A logical container that holds related Azure resources for a solution.",
    icon: "📁",
    scope: "resource-group",
    isContainer: true,
    nativeType: "Microsoft.Resources/resourceGroups",
    keywords: ["resource group", "rg", "container", "governance"],
    configFields: [
      {
        key: "location",
        label: "Location",
        type: "string",
        placeholder: "eastus",
        default: "eastus",
        required: true,
        help: "Azure region in which the resource group's metadata is stored.",
      },
      { key: "tags", label: "Tags", type: "tags" },
    ],
    // A resource group contains the resources of a solution. Containment is
    // normally expressed via parentId nesting, but surfacing the common members
    // here gives the palette useful "add inside" suggestions (no dead end).
    commonConnections: [
      { to: "azure-vnet", relationship: "contains" },
      { to: "azure-vm", relationship: "contains" },
      { to: "azure-storage-account", relationship: "contains" },
      { to: "azure-sql-server", relationship: "contains" },
      { to: "azure-aks", relationship: "contains" },
    ],
  },
];

export default management;
