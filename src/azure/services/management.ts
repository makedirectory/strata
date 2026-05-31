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
    commonConnections: [],
  },
];

export default management;
