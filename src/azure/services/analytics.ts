/**
 * Azure Analytics & AI/ML service catalog.
 * Synapse, Data Factory, Databricks and Stream Analytics for data workloads;
 * Azure Machine Learning workspace lives in the ai-ml category.
 */
import type { ServiceDefinition } from "../../aws/types";

const analytics: ServiceDefinition[] = [
  {
    id: "azure-synapse",
    name: "Synapse",
    fullName: "Azure Synapse Analytics Workspace",
    provider: "azure",
    category: "analytics",
    description: "A unified analytics service for data warehousing and big data.",
    icon: "🛰️",
    scope: "region",
    nativeType: "Microsoft.Synapse/workspaces",
    keywords: ["synapse", "analytics", "data warehouse", "spark"],
    configFields: [
      {
        key: "sqlAdminLogin",
        label: "SQL Admin Login",
        type: "string",
        placeholder: "sqladmin",
        required: true,
      },
      { key: "managedVnet", label: "Managed Virtual Network", type: "boolean", default: true },
    ],
    commonConnections: [
      { to: "azure-storage-account", relationship: "reads_from" },
      { to: "azure-key-vault", relationship: "reads_from" },
    ],
  },
  {
    id: "azure-data-factory",
    name: "Data Factory",
    fullName: "Azure Data Factory",
    abbreviation: "ADF",
    provider: "azure",
    category: "analytics",
    description: "A managed ETL/ELT service for orchestrating data pipelines.",
    icon: "🏭",
    scope: "region",
    nativeType: "Microsoft.DataFactory/factories",
    keywords: ["data factory", "adf", "etl", "pipeline", "orchestration"],
    configFields: [
      {
        key: "publicNetworkAccess",
        label: "Public Network Access",
        type: "select",
        default: "Enabled",
        options: [
          { value: "Enabled", label: "Enabled" },
          { value: "Disabled", label: "Disabled" },
        ],
      },
      { key: "gitIntegration", label: "Git Integration", type: "boolean", default: false },
    ],
    commonConnections: [
      { to: "azure-storage-account", relationship: "reads_from" },
      { to: "azure-sql-database", relationship: "writes_to" },
      { to: "azure-synapse", relationship: "writes_to" },
    ],
  },
  {
    id: "azure-databricks",
    name: "Databricks",
    fullName: "Azure Databricks Workspace",
    provider: "azure",
    category: "analytics",
    description: "An Apache Spark-based analytics and machine learning platform.",
    icon: "🧱",
    scope: "region",
    nativeType: "Microsoft.Databricks/workspaces",
    keywords: ["databricks", "spark", "lakehouse", "analytics"],
    configFields: [
      {
        key: "sku",
        label: "Pricing Tier",
        type: "select",
        default: "premium",
        options: [
          { value: "standard", label: "Standard" },
          { value: "premium", label: "Premium" },
        ],
      },
      {
        key: "managedResourceGroup",
        label: "Managed Resource Group",
        type: "string",
        placeholder: "databricks-rg",
      },
    ],
    commonConnections: [
      { to: "azure-storage-account", relationship: "reads_from" },
      { to: "azure-key-vault", relationship: "reads_from" },
    ],
  },
  {
    id: "azure-stream-analytics",
    name: "Stream Analytics",
    fullName: "Azure Stream Analytics Job",
    provider: "azure",
    category: "analytics",
    description: "Real-time stream processing with a SQL-like query language.",
    icon: "🌊",
    scope: "region",
    nativeType: "Microsoft.StreamAnalytics/streamingjobs",
    keywords: ["stream analytics", "streaming", "real-time", "sql"],
    configFields: [
      { key: "streamingUnits", label: "Streaming Units", type: "number", default: 3 },
      {
        key: "outputErrorPolicy",
        label: "Output Error Policy",
        type: "select",
        default: "Stop",
        options: [
          { value: "Stop", label: "Stop" },
          { value: "Drop", label: "Drop" },
        ],
      },
    ],
    commonConnections: [
      { to: "azure-event-hub", relationship: "reads_from" },
      { to: "azure-storage-account", relationship: "writes_to" },
    ],
  },
  {
    id: "azure-ml-workspace",
    name: "ML Workspace",
    fullName: "Azure Machine Learning Workspace",
    provider: "azure",
    category: "ai-ml",
    description: "A workspace for building, training and deploying ML models.",
    icon: "🧠",
    scope: "region",
    nativeType: "Microsoft.MachineLearningServices/workspaces",
    keywords: ["machine learning", "ml", "ai", "training", "mlops"],
    configFields: [
      {
        key: "sku",
        label: "Edition",
        type: "select",
        default: "Basic",
        options: [
          { value: "Basic", label: "Basic" },
          { value: "Enterprise", label: "Enterprise" },
        ],
      },
      { key: "hbiWorkspace", label: "High Business Impact", type: "boolean", default: false },
    ],
    commonConnections: [
      { to: "azure-storage-account", relationship: "reads_from" },
      { to: "azure-key-vault", relationship: "reads_from" },
    ],
  },
];

export default analytics;
