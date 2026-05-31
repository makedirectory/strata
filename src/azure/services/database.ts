/**
 * Azure Database service catalog.
 * SQL Server is a container for SQL Databases (parent → child via "contains").
 * Cosmos DB, PostgreSQL Flexible Server and Cache for Redis round out the set.
 */
import type { ServiceDefinition } from "../../aws/types";

const database: ServiceDefinition[] = [
  {
    id: "azure-sql-server",
    name: "SQL Server",
    fullName: "Azure SQL Server (logical server)",
    provider: "azure",
    category: "database",
    description: "A logical server that hosts one or more Azure SQL databases.",
    icon: "🗃️",
    scope: "region",
    isContainer: true,
    nativeType: "Microsoft.Sql/servers",
    keywords: ["sql server", "logical server", "database", "mssql"],
    configFields: [
      {
        key: "administratorLogin",
        label: "Admin Login",
        type: "string",
        placeholder: "sqladmin",
        required: true,
      },
      {
        key: "version",
        label: "Version",
        type: "select",
        default: "12.0",
        options: [{ value: "12.0", label: "12.0" }],
      },
      { key: "minimalTlsVersion", label: "Minimum TLS", type: "string", default: "1.2" },
    ],
    commonConnections: [
      { to: "azure-sql-database", relationship: "contains" },
      { to: "azure-key-vault", relationship: "reads_from" },
    ],
  },
  {
    id: "azure-sql-database",
    name: "SQL Database",
    fullName: "Azure SQL Database",
    provider: "azure",
    category: "database",
    description: "A fully managed relational database on a logical SQL server.",
    icon: "🛢️",
    scope: "region",
    nativeType: "Microsoft.Sql/servers/databases",
    keywords: ["sql database", "database", "relational", "paas"],
    configFields: [
      {
        key: "sku",
        label: "Service Tier",
        type: "select",
        default: "GP_Gen5_2",
        options: [
          { value: "Basic", label: "Basic" },
          { value: "S0", label: "Standard S0" },
          { value: "GP_Gen5_2", label: "General Purpose (2 vCores)" },
          { value: "BC_Gen5_4", label: "Business Critical (4 vCores)" },
        ],
      },
      { key: "maxSizeGb", label: "Max Size (GiB)", type: "number", default: 32 },
      { key: "zoneRedundant", label: "Zone Redundant", type: "boolean", default: false },
    ],
    commonConnections: [],
  },
  {
    id: "azure-cosmos-db",
    name: "Cosmos DB",
    fullName: "Azure Cosmos DB Account",
    provider: "azure",
    category: "database",
    description: "A globally distributed, multi-model NoSQL database service.",
    icon: "🌌",
    scope: "region",
    nativeType: "Microsoft.DocumentDB/databaseAccounts",
    keywords: ["cosmos db", "nosql", "globally distributed", "document"],
    configFields: [
      {
        key: "apiKind",
        label: "API",
        type: "select",
        default: "Sql",
        options: [
          { value: "Sql", label: "Core (SQL)" },
          { value: "MongoDB", label: "MongoDB" },
          { value: "Cassandra", label: "Cassandra" },
          { value: "Gremlin", label: "Gremlin" },
        ],
      },
      {
        key: "consistencyLevel",
        label: "Consistency",
        type: "select",
        default: "Session",
        options: [
          { value: "Strong", label: "Strong" },
          { value: "BoundedStaleness", label: "Bounded Staleness" },
          { value: "Session", label: "Session" },
          { value: "Eventual", label: "Eventual" },
        ],
      },
      { key: "enableMultiRegion", label: "Multi-region Writes", type: "boolean", default: false },
    ],
    commonConnections: [{ to: "azure-key-vault", relationship: "reads_from" }],
  },
  {
    id: "azure-postgresql",
    name: "PostgreSQL",
    fullName: "Azure Database for PostgreSQL (Flexible Server)",
    provider: "azure",
    category: "database",
    description: "A fully managed PostgreSQL flexible server with zone resiliency.",
    icon: "🐘",
    scope: "region",
    nativeType: "Microsoft.DBforPostgreSQL/flexibleServers",
    keywords: ["postgresql", "postgres", "flexible server", "database"],
    configFields: [
      {
        key: "version",
        label: "Version",
        type: "select",
        default: "16",
        options: [
          { value: "14", label: "14" },
          { value: "15", label: "15" },
          { value: "16", label: "16" },
        ],
      },
      {
        key: "sku",
        label: "Compute SKU",
        type: "string",
        placeholder: "Standard_D2ds_v5",
        default: "Standard_D2ds_v5",
      },
      { key: "storageGb", label: "Storage (GiB)", type: "number", default: 32 },
      { key: "highAvailability", label: "High Availability", type: "boolean", default: false },
    ],
    commonConnections: [{ to: "azure-subnet", relationship: "attached_to" }],
  },
  {
    id: "azure-redis",
    name: "Cache for Redis",
    fullName: "Azure Cache for Redis",
    provider: "azure",
    category: "database",
    description: "A managed in-memory data store for caching and low-latency reads.",
    icon: "🧊",
    scope: "region",
    nativeType: "Microsoft.Cache/redis",
    keywords: ["redis", "cache", "in-memory", "key-value"],
    configFields: [
      {
        key: "sku",
        label: "SKU",
        type: "select",
        default: "Standard",
        options: [
          { value: "Basic", label: "Basic" },
          { value: "Standard", label: "Standard" },
          { value: "Premium", label: "Premium" },
        ],
      },
      { key: "capacity", label: "Capacity", type: "number", default: 1 },
      { key: "enableNonSslPort", label: "Enable Non-SSL Port", type: "boolean", default: false },
    ],
    commonConnections: [{ to: "azure-app-service", relationship: "connects_to" }],
  },
];

export default database;
