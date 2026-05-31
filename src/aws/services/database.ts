/**
 * Database service catalog.
 * Every entry is a `ServiceDefinition` and the array is the default export,
 * following the canonical structure established in networking.ts.
 */
import type { ServiceDefinition } from "../types";

const database: ServiceDefinition[] = [
  {
    id: "rds",
    name: "RDS",
    fullName: "Amazon Relational Database Service",
    abbreviation: "RDS",
    category: "database",
    description:
      "Managed relational database supporting multiple engines like PostgreSQL and MySQL.",
    icon: "🛢️",
    scope: "vpc",
    cfnType: "AWS::RDS::DBInstance",
    arnPattern: "arn:aws:rds:{region}:{account}:db:{id}",
    keywords: ["rds", "relational", "sql", "postgres", "mysql", "database"],
    configFields: [
      {
        key: "engine",
        label: "Engine",
        type: "select",
        default: "postgres",
        options: [
          { value: "postgres", label: "PostgreSQL" },
          { value: "mysql", label: "MySQL" },
          { value: "mariadb", label: "MariaDB" },
          { value: "oracle-se2", label: "Oracle SE2" },
          { value: "sqlserver-se", label: "SQL Server SE" },
        ],
      },
      {
        key: "instanceClass",
        label: "Instance Class",
        type: "select",
        default: "db.t3.medium",
        options: [
          { value: "db.t3.micro", label: "db.t3.micro" },
          { value: "db.t3.medium", label: "db.t3.medium" },
          { value: "db.m5.large", label: "db.m5.large" },
          { value: "db.r5.xlarge", label: "db.r5.xlarge" },
        ],
      },
      { key: "allocatedStorage", label: "Allocated Storage (GiB)", type: "number", default: 20 },
      { key: "multiAz", label: "Multi-AZ", type: "boolean", default: false },
      { key: "storageEncrypted", label: "Storage Encrypted", type: "boolean", default: true },
    ],
    commonConnections: [
      {
        to: "security-group",
        relationship: "attached_to",
        description: "Controls inbound database access",
      },
      {
        to: "subnet-private",
        relationship: "depends_on",
        description: "Deployed in a DB subnet group",
      },
      {
        to: "secrets-manager",
        relationship: "reads_from",
        description: "Retrieves rotated credentials",
      },
      { to: "kms", relationship: "depends_on", description: "Encrypts storage at rest" },
    ],
  },
  {
    id: "aurora",
    name: "Aurora",
    fullName: "Amazon Aurora",
    category: "database",
    description:
      "MySQL- and PostgreSQL-compatible distributed relational database built for the cloud.",
    icon: "🌌",
    scope: "vpc",
    cfnType: "AWS::RDS::DBCluster",
    arnPattern: "arn:aws:rds:{region}:{account}:cluster:{id}",
    keywords: ["aurora", "cluster", "mysql", "postgres", "serverless", "relational"],
    configFields: [
      {
        key: "engine",
        label: "Engine",
        type: "select",
        default: "aurora-postgresql",
        options: [
          { value: "aurora-postgresql", label: "Aurora PostgreSQL" },
          { value: "aurora-mysql", label: "Aurora MySQL" },
        ],
      },
      {
        key: "engineMode",
        label: "Engine Mode",
        type: "select",
        default: "provisioned",
        options: [
          { value: "provisioned", label: "Provisioned" },
          { value: "serverless", label: "Serverless v2" },
        ],
      },
      {
        key: "instanceClass",
        label: "Instance Class",
        type: "select",
        default: "db.r6g.large",
        options: [
          { value: "db.r6g.large", label: "db.r6g.large" },
          { value: "db.r6g.xlarge", label: "db.r6g.xlarge" },
          { value: "db.r5.2xlarge", label: "db.r5.2xlarge" },
        ],
      },
      { key: "replicaCount", label: "Read Replicas", type: "number", default: 1 },
    ],
    commonConnections: [
      { to: "security-group", relationship: "attached_to", description: "Controls cluster access" },
      { to: "subnet-private", relationship: "depends_on", description: "Spans private DB subnets" },
      {
        to: "secrets-manager",
        relationship: "reads_from",
        description: "Retrieves master credentials",
      },
      { to: "kms", relationship: "depends_on", description: "Encrypts cluster storage" },
    ],
  },
  {
    id: "dynamodb",
    name: "DynamoDB",
    fullName: "Amazon DynamoDB",
    category: "database",
    description:
      "Fully managed serverless key-value and document NoSQL database with single-digit millisecond latency.",
    icon: "⚡",
    scope: "region",
    cfnType: "AWS::DynamoDB::Table",
    arnPattern: "arn:aws:dynamodb:{region}:{account}:table/{id}",
    keywords: ["dynamodb", "nosql", "key-value", "document", "serverless"],
    configFields: [
      {
        key: "billingMode",
        label: "Billing Mode",
        type: "select",
        default: "PAY_PER_REQUEST",
        options: [
          { value: "PAY_PER_REQUEST", label: "On-Demand" },
          { value: "PROVISIONED", label: "Provisioned" },
        ],
      },
      {
        key: "partitionKey",
        label: "Partition Key",
        type: "string",
        placeholder: "pk",
        required: true,
      },
      { key: "sortKey", label: "Sort Key", type: "string", placeholder: "sk" },
      { key: "streamEnabled", label: "Streams Enabled", type: "boolean", default: false },
      {
        key: "pointInTimeRecovery",
        label: "Point-in-Time Recovery",
        type: "boolean",
        default: true,
      },
    ],
    commonConnections: [
      { to: "lambda", relationship: "invokes", description: "Streams trigger Lambda consumers" },
      { to: "kms", relationship: "depends_on", description: "Encrypts table at rest" },
      {
        to: "vpc-endpoint",
        relationship: "connects_to",
        description: "Private access via gateway endpoint",
      },
    ],
  },
  {
    id: "elasticache",
    name: "ElastiCache",
    fullName: "Amazon ElastiCache",
    category: "database",
    description: "Managed in-memory caching service supporting Redis and Memcached engines.",
    icon: "🧊",
    scope: "vpc",
    cfnType: "AWS::ElastiCache::ReplicationGroup",
    arnPattern: "arn:aws:elasticache:{region}:{account}:replicationgroup:{id}",
    keywords: ["elasticache", "redis", "memcached", "cache", "in-memory"],
    configFields: [
      {
        key: "engine",
        label: "Engine",
        type: "select",
        default: "redis",
        options: [
          { value: "redis", label: "Redis" },
          { value: "memcached", label: "Memcached" },
        ],
      },
      {
        key: "nodeType",
        label: "Node Type",
        type: "select",
        default: "cache.r6g.large",
        options: [
          { value: "cache.t3.micro", label: "cache.t3.micro" },
          { value: "cache.r6g.large", label: "cache.r6g.large" },
          { value: "cache.r6g.xlarge", label: "cache.r6g.xlarge" },
        ],
      },
      { key: "numNodes", label: "Number of Nodes", type: "number", default: 2 },
      { key: "automaticFailover", label: "Automatic Failover", type: "boolean", default: true },
    ],
    commonConnections: [
      {
        to: "security-group",
        relationship: "attached_to",
        description: "Controls access to cache nodes",
      },
      {
        to: "subnet-private",
        relationship: "depends_on",
        description: "Deployed in a cache subnet group",
      },
      {
        to: "ec2-instance",
        relationship: "connects_to",
        description: "Application reads/writes cache",
      },
    ],
  },
  {
    id: "documentdb",
    name: "DocumentDB",
    fullName: "Amazon DocumentDB (with MongoDB compatibility)",
    category: "database",
    description: "Managed MongoDB-compatible document database for JSON workloads at scale.",
    icon: "🍃",
    scope: "vpc",
    cfnType: "AWS::DocDB::DBCluster",
    arnPattern: "arn:aws:rds:{region}:{account}:cluster:{id}",
    keywords: ["documentdb", "docdb", "mongodb", "document", "nosql"],
    configFields: [
      {
        key: "instanceClass",
        label: "Instance Class",
        type: "select",
        default: "db.r6g.large",
        options: [
          { value: "db.r6g.large", label: "db.r6g.large" },
          { value: "db.r6g.xlarge", label: "db.r6g.xlarge" },
          { value: "db.r5.2xlarge", label: "db.r5.2xlarge" },
        ],
      },
      { key: "instanceCount", label: "Instance Count", type: "number", default: 3 },
      { key: "storageEncrypted", label: "Storage Encrypted", type: "boolean", default: true },
    ],
    commonConnections: [
      { to: "security-group", relationship: "attached_to", description: "Controls cluster access" },
      { to: "subnet-private", relationship: "depends_on", description: "Spans private DB subnets" },
      { to: "kms", relationship: "depends_on", description: "Encrypts cluster storage" },
    ],
  },
  {
    id: "neptune",
    name: "Neptune",
    fullName: "Amazon Neptune",
    category: "database",
    description: "Fully managed graph database service for highly connected datasets.",
    icon: "🔱",
    scope: "vpc",
    cfnType: "AWS::Neptune::DBCluster",
    arnPattern: "arn:aws:rds:{region}:{account}:cluster:{id}",
    keywords: ["neptune", "graph", "gremlin", "sparql", "rdf"],
    configFields: [
      {
        key: "instanceClass",
        label: "Instance Class",
        type: "select",
        default: "db.r6g.large",
        options: [
          { value: "db.r6g.large", label: "db.r6g.large" },
          { value: "db.r6g.xlarge", label: "db.r6g.xlarge" },
          { value: "db.r5.2xlarge", label: "db.r5.2xlarge" },
        ],
      },
      {
        key: "queryLanguage",
        label: "Query Language",
        type: "select",
        default: "gremlin",
        options: [
          { value: "gremlin", label: "Gremlin" },
          { value: "sparql", label: "SPARQL" },
          { value: "opencypher", label: "openCypher" },
        ],
      },
      { key: "storageEncrypted", label: "Storage Encrypted", type: "boolean", default: true },
    ],
    commonConnections: [
      { to: "security-group", relationship: "attached_to", description: "Controls cluster access" },
      { to: "subnet-private", relationship: "depends_on", description: "Spans private DB subnets" },
      { to: "kms", relationship: "depends_on", description: "Encrypts cluster storage" },
    ],
  },
  {
    id: "memorydb",
    name: "MemoryDB",
    fullName: "Amazon MemoryDB for Redis",
    category: "database",
    description:
      "Redis-compatible, durable in-memory database for microsecond reads and durability.",
    icon: "💾",
    scope: "vpc",
    cfnType: "AWS::MemoryDB::Cluster",
    arnPattern: "arn:aws:memorydb:{region}:{account}:cluster/{id}",
    keywords: ["memorydb", "redis", "in-memory", "durable", "cache"],
    configFields: [
      {
        key: "nodeType",
        label: "Node Type",
        type: "select",
        default: "db.r6g.large",
        options: [
          { value: "db.t4g.small", label: "db.t4g.small" },
          { value: "db.r6g.large", label: "db.r6g.large" },
          { value: "db.r6g.xlarge", label: "db.r6g.xlarge" },
        ],
      },
      { key: "numShards", label: "Number of Shards", type: "number", default: 2 },
      { key: "replicasPerShard", label: "Replicas per Shard", type: "number", default: 1 },
    ],
    commonConnections: [
      {
        to: "security-group",
        relationship: "attached_to",
        description: "Controls access to cluster",
      },
      {
        to: "subnet-private",
        relationship: "depends_on",
        description: "Deployed in a subnet group",
      },
      { to: "kms", relationship: "depends_on", description: "Encrypts data at rest" },
    ],
  },
];

export default database;
