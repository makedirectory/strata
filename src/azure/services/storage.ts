/**
 * Azure Storage service catalog.
 * Storage Account is the parent resource; Blob Containers are child resources
 * of the account's blob service. Managed Disks back VM data/OS volumes.
 */
import type { ServiceDefinition } from "../../aws/types";

const storage: ServiceDefinition[] = [
  {
    id: "azure-storage-account",
    name: "Storage Account",
    fullName: "Azure Storage Account",
    provider: "azure",
    category: "storage",
    description: "A namespace for blobs, files, queues and tables with redundant storage.",
    icon: "🗄️",
    scope: "region",
    isContainer: true,
    nativeType: "Microsoft.Storage/storageAccounts",
    keywords: ["storage account", "blob", "file", "queue", "table"],
    configFields: [
      {
        key: "sku",
        label: "Redundancy (SKU)",
        type: "select",
        default: "Standard_LRS",
        options: [
          { value: "Standard_LRS", label: "Locally redundant (LRS)" },
          { value: "Standard_ZRS", label: "Zone redundant (ZRS)" },
          { value: "Standard_GRS", label: "Geo redundant (GRS)" },
          { value: "Premium_LRS", label: "Premium LRS" },
        ],
      },
      {
        key: "kind",
        label: "Account Kind",
        type: "select",
        default: "StorageV2",
        options: [
          { value: "StorageV2", label: "StorageV2 (general purpose v2)" },
          { value: "BlobStorage", label: "BlobStorage" },
          { value: "FileStorage", label: "FileStorage" },
        ],
      },
      {
        key: "accessTier",
        label: "Access Tier",
        type: "select",
        default: "Hot",
        options: [
          { value: "Hot", label: "Hot" },
          { value: "Cool", label: "Cool" },
        ],
      },
      {
        key: "allowPublicAccess",
        label: "Allow Public Blob Access",
        type: "boolean",
        default: false,
      },
    ],
    commonConnections: [
      { to: "azure-blob-container", relationship: "contains" },
      { to: "azure-storage-queue", relationship: "contains" },
    ],
  },
  {
    id: "azure-blob-container",
    name: "Blob Container",
    fullName: "Azure Blob Storage Container",
    provider: "azure",
    category: "storage",
    description: "A container that groups blobs within a storage account.",
    icon: "🪣",
    scope: "region",
    nativeType: "Microsoft.Storage/storageAccounts/blobServices/containers",
    keywords: ["blob", "container", "object storage", "bucket"],
    configFields: [
      { key: "name", label: "Container Name", type: "string", placeholder: "data", required: true },
      {
        key: "publicAccess",
        label: "Public Access",
        type: "select",
        default: "None",
        options: [
          { value: "None", label: "Private (None)" },
          { value: "Blob", label: "Blob" },
          { value: "Container", label: "Container" },
        ],
      },
    ],
    commonConnections: [],
  },
  {
    id: "azure-managed-disk",
    name: "Managed Disk",
    fullName: "Azure Managed Disk",
    provider: "azure",
    category: "storage",
    description: "A block-level storage volume managed by Azure for VMs.",
    icon: "💽",
    scope: "region",
    nativeType: "Microsoft.Compute/disks",
    keywords: ["managed disk", "disk", "block storage", "volume"],
    configFields: [
      {
        key: "sku",
        label: "Disk Type",
        type: "select",
        default: "Premium_LRS",
        options: [
          { value: "Standard_LRS", label: "Standard HDD (LRS)" },
          { value: "StandardSSD_LRS", label: "Standard SSD (LRS)" },
          { value: "Premium_LRS", label: "Premium SSD (LRS)" },
          { value: "UltraSSD_LRS", label: "Ultra Disk (LRS)" },
        ],
      },
      { key: "sizeGb", label: "Size (GiB)", type: "number", default: 128 },
    ],
    commonConnections: [{ to: "azure-vm", relationship: "attached_to" }],
  },
];

export default storage;
