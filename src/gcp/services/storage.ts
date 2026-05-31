/**
 * Google Cloud — Storage service catalog.
 */
import type { ServiceDefinition } from "../../aws/types";

const storage: ServiceDefinition[] = [
  {
    id: "gcp-cloud-storage",
    name: "Cloud Storage",
    fullName: "Google Cloud Storage Bucket",
    abbreviation: "GCS",
    provider: "gcp",
    category: "storage",
    description: "Durable, highly available object storage for any amount of data.",
    icon: "🪣",
    scope: "global",
    nativeType: "storage.googleapis.com/Bucket",
    keywords: ["gcs", "bucket", "object storage", "blob"],
    configFields: [
      {
        key: "storageClass",
        label: "Storage Class",
        type: "select",
        default: "STANDARD",
        options: [
          { value: "STANDARD", label: "Standard" },
          { value: "NEARLINE", label: "Nearline" },
          { value: "COLDLINE", label: "Coldline" },
          { value: "ARCHIVE", label: "Archive" },
        ],
      },
      { key: "location", label: "Location", type: "string", placeholder: "US" },
      { key: "uniformBucketLevelAccess", label: "Uniform Access", type: "boolean", default: true },
      { key: "versioning", label: "Versioning", type: "boolean", default: false },
    ],
    commonConnections: [
      {
        to: "gcp-cloud-functions",
        relationship: "invokes",
        description: "Object events trigger functions",
      },
      { to: "gcp-bigquery-dataset", relationship: "writes_to" },
    ],
  },
  {
    id: "gcp-persistent-disk",
    name: "Persistent Disk",
    fullName: "Compute Engine Persistent Disk",
    abbreviation: "PD",
    provider: "gcp",
    category: "storage",
    description: "Durable block storage that can attach to Compute Engine instances.",
    icon: "💽",
    scope: "region",
    nativeType: "compute.googleapis.com/Disk",
    keywords: ["disk", "persistent disk", "block storage", "pd"],
    configFields: [
      {
        key: "type",
        label: "Disk Type",
        type: "select",
        default: "pd-balanced",
        options: [
          { value: "pd-standard", label: "Standard (HDD)" },
          { value: "pd-balanced", label: "Balanced (SSD)" },
          { value: "pd-ssd", label: "SSD" },
          { value: "pd-extreme", label: "Extreme" },
        ],
      },
      { key: "sizeGb", label: "Size (GB)", type: "number", default: 100 },
      { key: "zone", label: "Zone", type: "string", placeholder: "us-central1-a" },
    ],
    commonConnections: [{ to: "gcp-compute-engine", relationship: "attached_to" }],
  },
  {
    id: "gcp-filestore",
    name: "Filestore",
    fullName: "Google Cloud Filestore Instance",
    provider: "gcp",
    category: "storage",
    description: "Managed NFS file storage for applications that need a filesystem.",
    icon: "🗄️",
    scope: "region",
    nativeType: "file.googleapis.com/Instance",
    keywords: ["filestore", "nfs", "file storage", "shared"],
    configFields: [
      {
        key: "tier",
        label: "Service Tier",
        type: "select",
        default: "BASIC_HDD",
        options: [
          { value: "BASIC_HDD", label: "Basic HDD" },
          { value: "BASIC_SSD", label: "Basic SSD" },
          { value: "ENTERPRISE", label: "Enterprise" },
        ],
      },
      { key: "capacityGb", label: "Capacity (GB)", type: "number", default: 1024 },
      { key: "zone", label: "Zone", type: "string", placeholder: "us-central1-a" },
    ],
    commonConnections: [
      { to: "gcp-compute-engine", relationship: "attached_to" },
      { to: "gcp-vpc-network", relationship: "attached_to" },
    ],
  },
];

export default storage;
