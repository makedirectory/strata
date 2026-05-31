/**
 * Google Cloud — Analytics & AI/ML service catalog.
 */
import type { ServiceDefinition } from "../../aws/types";

const analytics: ServiceDefinition[] = [
  {
    id: "gcp-bigquery-dataset",
    name: "BigQuery Dataset",
    fullName: "Google BigQuery Dataset",
    abbreviation: "BQ",
    provider: "gcp",
    category: "analytics",
    description: "A top-level container that organizes BigQuery tables and views.",
    icon: "🗃️",
    scope: "region",
    nativeType: "bigquery.googleapis.com/Dataset",
    keywords: ["bigquery", "dataset", "data warehouse", "analytics"],
    configFields: [
      { key: "location", label: "Location", type: "string", placeholder: "US" },
      {
        key: "defaultTableExpirationMs",
        label: "Default Table Expiration (ms)",
        type: "number",
        placeholder: "5184000000",
      },
      {
        key: "defaultCollation",
        label: "Default Collation",
        type: "select",
        default: "case-sensitive",
        options: [
          { value: "case-sensitive", label: "Case-sensitive" },
          { value: "case-insensitive", label: "Case-insensitive" },
        ],
      },
    ],
    commonConnections: [
      {
        to: "gcp-bigquery-table",
        relationship: "contains",
        description: "Dataset contains tables",
      },
    ],
  },
  {
    id: "gcp-bigquery-table",
    name: "BigQuery Table",
    fullName: "Google BigQuery Table",
    provider: "gcp",
    category: "analytics",
    description: "A structured, columnar table within a BigQuery dataset.",
    icon: "📋",
    scope: "region",
    nativeType: "bigquery.googleapis.com/Table",
    keywords: ["bigquery", "table", "columnar", "schema"],
    configFields: [
      {
        key: "tableType",
        label: "Table Type",
        type: "select",
        default: "TABLE",
        options: [
          { value: "TABLE", label: "Table" },
          { value: "VIEW", label: "View" },
          { value: "MATERIALIZED_VIEW", label: "Materialized View" },
          { value: "EXTERNAL", label: "External" },
        ],
      },
      {
        key: "partitionField",
        label: "Partition Field",
        type: "string",
        placeholder: "event_date",
      },
      {
        key: "clusteringFields",
        label: "Clustering Fields",
        type: "text",
        placeholder: "user_id, region",
      },
    ],
    commonConnections: [
      { to: "gcp-bigquery-dataset", relationship: "attached_to" },
      { to: "gcp-cloud-storage", relationship: "reads_from" },
    ],
  },
  {
    id: "gcp-dataflow",
    name: "Dataflow",
    fullName: "Google Cloud Dataflow Job",
    provider: "gcp",
    category: "analytics",
    description: "Managed Apache Beam service for stream and batch data processing.",
    icon: "🌊",
    scope: "region",
    nativeType: "dataflow.googleapis.com/Job",
    keywords: ["dataflow", "beam", "streaming", "batch", "etl"],
    configFields: [
      {
        key: "jobType",
        label: "Job Type",
        type: "select",
        default: "JOB_TYPE_STREAMING",
        options: [
          { value: "JOB_TYPE_BATCH", label: "Batch" },
          { value: "JOB_TYPE_STREAMING", label: "Streaming" },
        ],
      },
      { key: "maxWorkers", label: "Max Workers", type: "number", default: 10 },
      {
        key: "machineType",
        label: "Worker Machine Type",
        type: "string",
        placeholder: "n1-standard-2",
      },
    ],
    commonConnections: [
      { to: "gcp-pubsub-topic", relationship: "reads_from" },
      { to: "gcp-bigquery-table", relationship: "writes_to" },
      { to: "gcp-cloud-storage", relationship: "writes_to" },
    ],
  },
  {
    id: "gcp-dataproc",
    name: "Dataproc",
    fullName: "Google Cloud Dataproc Cluster",
    provider: "gcp",
    category: "analytics",
    description: "Managed Spark and Hadoop clusters for big data processing.",
    icon: "🐘",
    scope: "region",
    nativeType: "dataproc.googleapis.com/Cluster",
    keywords: ["dataproc", "spark", "hadoop", "big data"],
    configFields: [
      {
        key: "masterMachineType",
        label: "Master Machine Type",
        type: "string",
        placeholder: "n2-standard-4",
      },
      { key: "workerCount", label: "Worker Count", type: "number", default: 2 },
      { key: "imageVersion", label: "Image Version", type: "string", placeholder: "2.2-debian12" },
    ],
    commonConnections: [
      { to: "gcp-cloud-storage", relationship: "reads_from" },
      { to: "gcp-bigquery-dataset", relationship: "writes_to" },
    ],
  },
  {
    id: "gcp-vertex-ai-endpoint",
    name: "Vertex AI Endpoint",
    fullName: "Google Vertex AI Endpoint",
    provider: "gcp",
    category: "ai-ml",
    description: "A managed endpoint serving online predictions from a deployed model.",
    icon: "🧠",
    scope: "region",
    nativeType: "aiplatform.googleapis.com/Endpoint",
    keywords: ["vertex ai", "ml", "model", "endpoint", "prediction"],
    configFields: [
      { key: "machineType", label: "Machine Type", type: "string", placeholder: "n1-standard-4" },
      { key: "minReplicaCount", label: "Min Replicas", type: "number", default: 1 },
      { key: "maxReplicaCount", label: "Max Replicas", type: "number", default: 3 },
      {
        key: "acceleratorType",
        label: "Accelerator",
        type: "select",
        default: "NONE",
        options: [
          { value: "NONE", label: "None" },
          { value: "NVIDIA_TESLA_T4", label: "NVIDIA T4" },
          { value: "NVIDIA_L4", label: "NVIDIA L4" },
        ],
      },
    ],
    commonConnections: [
      { to: "gcp-cloud-run", relationship: "invokes" },
      { to: "gcp-cloud-storage", relationship: "reads_from" },
    ],
  },
];

export default analytics;
