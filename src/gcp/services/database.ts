/**
 * Google Cloud — Database service catalog.
 */
import type { ServiceDefinition } from "../../aws/types";

const database: ServiceDefinition[] = [
  {
    id: "gcp-cloud-sql",
    name: "Cloud SQL",
    fullName: "Google Cloud SQL Instance",
    provider: "gcp",
    category: "database",
    description: "Managed relational database for MySQL, PostgreSQL and SQL Server.",
    icon: "🛢️",
    scope: "region",
    nativeType: "sqladmin.googleapis.com/Instance",
    keywords: ["cloud sql", "mysql", "postgres", "relational", "rdbms"],
    configFields: [
      {
        key: "databaseVersion",
        label: "Database Engine",
        type: "select",
        default: "POSTGRES_15",
        options: [
          { value: "POSTGRES_15", label: "PostgreSQL 15" },
          { value: "MYSQL_8_0", label: "MySQL 8.0" },
          { value: "SQLSERVER_2022_STANDARD", label: "SQL Server 2022" },
        ],
      },
      { key: "tier", label: "Machine Tier", type: "string", placeholder: "db-custom-2-7680" },
      { key: "storageGb", label: "Storage (GB)", type: "number", default: 10 },
      { key: "highAvailability", label: "High Availability", type: "boolean", default: false },
      { key: "requireSsl", label: "Require SSL", type: "boolean", default: true },
      { key: "ipv4Enabled", label: "Public IP (IPv4)", type: "boolean", default: false },
      { key: "authorizedNetworks", label: "Authorized Networks (CIDR)", type: "string" },
    ],
    commonConnections: [
      { to: "gcp-vpc-network", relationship: "attached_to" },
      { to: "gcp-cloud-run", relationship: "connects_to" },
    ],
  },
  {
    id: "gcp-spanner",
    name: "Spanner",
    fullName: "Google Cloud Spanner Instance",
    provider: "gcp",
    category: "database",
    description: "Globally distributed, strongly consistent relational database.",
    icon: "🌎",
    scope: "global",
    nativeType: "spanner.googleapis.com/Instance",
    keywords: ["spanner", "distributed", "relational", "global", "consistent"],
    configFields: [
      {
        key: "config",
        label: "Instance Config",
        type: "string",
        placeholder: "regional-us-central1",
      },
      { key: "nodeCount", label: "Node Count", type: "number", default: 1 },
      {
        key: "edition",
        label: "Edition",
        type: "select",
        default: "STANDARD",
        options: [
          { value: "STANDARD", label: "Standard" },
          { value: "ENTERPRISE", label: "Enterprise" },
          { value: "ENTERPRISE_PLUS", label: "Enterprise Plus" },
        ],
      },
    ],
    commonConnections: [{ to: "gcp-cloud-run", relationship: "connects_to" }],
  },
  {
    id: "gcp-bigtable",
    name: "Bigtable",
    fullName: "Google Cloud Bigtable Instance",
    provider: "gcp",
    category: "database",
    description: "Petabyte-scale NoSQL wide-column database for analytical workloads.",
    icon: "📊",
    scope: "region",
    nativeType: "bigtableadmin.googleapis.com/Instance",
    keywords: ["bigtable", "nosql", "wide-column", "hbase"],
    configFields: [
      {
        key: "instanceType",
        label: "Instance Type",
        type: "select",
        default: "PRODUCTION",
        options: [
          { value: "PRODUCTION", label: "Production" },
          { value: "DEVELOPMENT", label: "Development" },
        ],
      },
      {
        key: "storageType",
        label: "Storage Type",
        type: "select",
        default: "SSD",
        options: [
          { value: "SSD", label: "SSD" },
          { value: "HDD", label: "HDD" },
        ],
      },
      { key: "numNodes", label: "Node Count", type: "number", default: 3 },
    ],
    commonConnections: [{ to: "gcp-dataflow", relationship: "reads_from" }],
  },
  {
    id: "gcp-firestore",
    name: "Firestore",
    fullName: "Google Cloud Firestore Database",
    provider: "gcp",
    category: "database",
    description: "Serverless, scalable NoSQL document database with realtime sync.",
    icon: "🔥",
    scope: "region",
    nativeType: "firestore.googleapis.com/Database",
    keywords: ["firestore", "nosql", "document", "realtime", "datastore"],
    configFields: [
      {
        key: "mode",
        label: "Mode",
        type: "select",
        default: "FIRESTORE_NATIVE",
        options: [
          { value: "FIRESTORE_NATIVE", label: "Native" },
          { value: "DATASTORE_MODE", label: "Datastore Mode" },
        ],
      },
      { key: "locationId", label: "Location", type: "string", placeholder: "nam5" },
      {
        key: "concurrencyMode",
        label: "Concurrency",
        type: "select",
        default: "OPTIMISTIC",
        options: [
          { value: "OPTIMISTIC", label: "Optimistic" },
          { value: "PESSIMISTIC", label: "Pessimistic" },
        ],
      },
    ],
    commonConnections: [
      {
        to: "gcp-cloud-functions",
        relationship: "invokes",
        description: "Document changes trigger functions",
      },
    ],
  },
  {
    id: "gcp-memorystore",
    name: "Memorystore",
    fullName: "Google Cloud Memorystore for Redis",
    provider: "gcp",
    category: "database",
    description: "Fully managed in-memory Redis service for caching and low latency.",
    icon: "⚡",
    scope: "region",
    nativeType: "redis.googleapis.com/Instance",
    keywords: ["memorystore", "redis", "cache", "in-memory"],
    configFields: [
      {
        key: "tier",
        label: "Service Tier",
        type: "select",
        default: "STANDARD_HA",
        options: [
          { value: "BASIC", label: "Basic" },
          { value: "STANDARD_HA", label: "Standard (HA)" },
        ],
      },
      { key: "memorySizeGb", label: "Memory (GB)", type: "number", default: 1 },
      { key: "redisVersion", label: "Redis Version", type: "string", placeholder: "REDIS_7_2" },
    ],
    commonConnections: [
      { to: "gcp-vpc-network", relationship: "attached_to" },
      { to: "gcp-cloud-run", relationship: "connects_to" },
    ],
  },
];

export default database;
