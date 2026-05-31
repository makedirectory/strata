/**
 * Analytics service catalog.
 * Mirrors the structure of networking.ts: every entry is a `ServiceDefinition`
 * and the array is the default export.
 */
import type { ServiceDefinition } from "../types";

const analytics: ServiceDefinition[] = [
  {
    id: "athena",
    name: "Athena",
    fullName: "Amazon Athena",
    category: "analytics",
    description:
      "Serverless interactive query service that analyzes data in S3 using standard SQL.",
    icon: "🧮",
    scope: "region",
    cfnType: "AWS::Athena::WorkGroup",
    arnPattern: "arn:aws:athena:{region}:{account}:workgroup/{name}",
    keywords: ["athena", "query", "sql", "serverless", "presto"],
    configFields: [
      {
        key: "workgroup",
        label: "Workgroup",
        type: "string",
        placeholder: "primary",
        default: "primary",
      },
      {
        key: "engineVersion",
        label: "Engine Version",
        type: "select",
        default: "Athena engine version 3",
        options: [
          { value: "Athena engine version 3", label: "Engine version 3" },
          { value: "Athena engine version 2", label: "Engine version 2" },
        ],
      },
      {
        key: "outputLocation",
        label: "Query Output Location",
        type: "string",
        placeholder: "s3://my-bucket/athena-results/",
      },
    ],
    commonConnections: [
      {
        to: "s3-bucket",
        relationship: "reads_from",
        description: "Athena queries data stored in S3",
      },
      {
        to: "glue",
        relationship: "reads_from",
        description: "Uses the Glue Data Catalog for table metadata",
      },
      {
        to: "quicksight",
        relationship: "connects_to",
        description: "Feeds query results into BI dashboards",
      },
    ],
  },
  {
    id: "glue",
    name: "Glue",
    fullName: "AWS Glue",
    category: "analytics",
    description:
      "Serverless data integration service for discovering, cataloging, and transforming data (ETL).",
    icon: "🧪",
    scope: "region",
    cfnType: "AWS::Glue::Job",
    arnPattern: "arn:aws:glue:{region}:{account}:job/{name}",
    keywords: ["glue", "etl", "catalog", "crawler", "data integration"],
    configFields: [
      {
        key: "jobType",
        label: "Job Type",
        type: "select",
        default: "glueetl",
        options: [
          { value: "glueetl", label: "Spark ETL" },
          { value: "pythonshell", label: "Python Shell" },
          { value: "gluestreaming", label: "Streaming ETL" },
        ],
      },
      {
        key: "glueVersion",
        label: "Glue Version",
        type: "select",
        default: "4.0",
        options: [
          { value: "4.0", label: "4.0" },
          { value: "3.0", label: "3.0" },
          { value: "2.0", label: "2.0" },
        ],
      },
      {
        key: "workerType",
        label: "Worker Type",
        type: "select",
        default: "G.1X",
        options: [
          { value: "G.1X", label: "G.1X" },
          { value: "G.2X", label: "G.2X" },
          { value: "G.4X", label: "G.4X" },
        ],
      },
      { key: "numberOfWorkers", label: "Number of Workers", type: "number", default: 10 },
    ],
    commonConnections: [
      {
        to: "s3-bucket",
        relationship: "reads_from",
        description: "Crawls and transforms data in S3",
      },
      {
        to: "s3-bucket",
        relationship: "writes_to",
        description: "Writes transformed output back to S3",
      },
      {
        to: "redshift",
        relationship: "writes_to",
        description: "Loads curated data into the warehouse",
      },
      { to: "iam-role", relationship: "assumes", description: "Job execution role" },
    ],
  },
  {
    id: "redshift",
    name: "Redshift",
    fullName: "Amazon Redshift",
    category: "analytics",
    description: "Fully managed petabyte-scale cloud data warehouse for analytics workloads.",
    icon: "🏬",
    scope: "vpc",
    cfnType: "AWS::Redshift::Cluster",
    arnPattern: "arn:aws:redshift:{region}:{account}:cluster:{name}",
    keywords: ["redshift", "data warehouse", "olap", "columnar", "analytics"],
    configFields: [
      {
        key: "nodeType",
        label: "Node Type",
        type: "select",
        default: "ra3.xlplus",
        options: [
          { value: "ra3.large", label: "ra3.large" },
          { value: "ra3.xlplus", label: "ra3.xlplus" },
          { value: "ra3.4xlarge", label: "ra3.4xlarge" },
          { value: "ra3.16xlarge", label: "ra3.16xlarge" },
          { value: "dc2.large", label: "dc2.large" },
        ],
      },
      { key: "numberOfNodes", label: "Number of Nodes", type: "number", default: 2 },
      {
        key: "clusterType",
        label: "Cluster Type",
        type: "select",
        default: "multi-node",
        options: [
          { value: "single-node", label: "Single Node" },
          { value: "multi-node", label: "Multi Node" },
        ],
      },
      { key: "encrypted", label: "Encrypted", type: "boolean", default: true },
    ],
    commonConnections: [
      {
        to: "s3-bucket",
        relationship: "reads_from",
        description: "COPY/UNLOAD and Redshift Spectrum against S3",
      },
      { to: "quicksight", relationship: "connects_to", description: "Source for BI dashboards" },
      { to: "kms", relationship: "depends_on", description: "Encrypts cluster storage" },
    ],
  },
  {
    id: "emr",
    name: "EMR",
    fullName: "Amazon EMR",
    abbreviation: "EMR",
    category: "analytics",
    description: "Managed big data platform for running Apache Spark, Hadoop, Hive, and Presto.",
    icon: "🐘",
    scope: "vpc",
    isContainer: true,
    cfnType: "AWS::EMR::Cluster",
    arnPattern: "arn:aws:elasticmapreduce:{region}:{account}:cluster/{id}",
    keywords: ["emr", "spark", "hadoop", "big data", "hive"],
    configFields: [
      {
        key: "releaseLabel",
        label: "Release",
        type: "string",
        placeholder: "emr-7.1.0",
        default: "emr-7.1.0",
      },
      {
        key: "instanceType",
        label: "Instance Type",
        type: "select",
        default: "m5.xlarge",
        options: [
          { value: "m5.xlarge", label: "m5.xlarge" },
          { value: "m5.2xlarge", label: "m5.2xlarge" },
          { value: "r5.xlarge", label: "r5.xlarge" },
          { value: "c5.2xlarge", label: "c5.2xlarge" },
        ],
      },
      { key: "instanceCount", label: "Instance Count", type: "number", default: 3 },
      {
        key: "applications",
        label: "Applications",
        type: "multiselect",
        options: [
          { value: "Spark", label: "Spark" },
          { value: "Hadoop", label: "Hadoop" },
          { value: "Hive", label: "Hive" },
          { value: "Presto", label: "Presto" },
          { value: "HBase", label: "HBase" },
        ],
      },
    ],
    commonConnections: [
      {
        to: "s3-bucket",
        relationship: "reads_from",
        description: "Reads and writes job data via EMRFS",
      },
      { to: "s3-bucket", relationship: "writes_to", description: "Persists job output to S3" },
      {
        to: "ec2-instance",
        relationship: "contains",
        description: "Runs on a managed EC2 instance fleet",
      },
      {
        to: "glue",
        relationship: "reads_from",
        description: "Uses the Glue Data Catalog for table metadata",
      },
    ],
  },
  {
    id: "kinesis-firehose",
    name: "Firehose",
    fullName: "Amazon Data Firehose",
    category: "analytics",
    description:
      "Fully managed service that delivers streaming data to destinations like S3, Redshift, and OpenSearch.",
    icon: "🚒",
    scope: "region",
    cfnType: "AWS::KinesisFirehose::DeliveryStream",
    arnPattern: "arn:aws:firehose:{region}:{account}:deliverystream/{name}",
    keywords: ["firehose", "streaming", "delivery", "ingest", "kinesis"],
    configFields: [
      {
        key: "destination",
        label: "Destination",
        type: "select",
        default: "s3",
        options: [
          { value: "s3", label: "Amazon S3" },
          { value: "redshift", label: "Amazon Redshift" },
          { value: "opensearch", label: "Amazon OpenSearch" },
          { value: "http", label: "HTTP Endpoint" },
        ],
      },
      { key: "bufferSizeMb", label: "Buffer Size (MB)", type: "number", default: 5 },
      { key: "bufferIntervalSeconds", label: "Buffer Interval (s)", type: "number", default: 300 },
      {
        key: "compression",
        label: "Compression",
        type: "select",
        default: "GZIP",
        options: [
          { value: "UNCOMPRESSED", label: "Uncompressed" },
          { value: "GZIP", label: "GZIP" },
          { value: "Snappy", label: "Snappy" },
        ],
      },
    ],
    commonConnections: [
      {
        to: "s3-bucket",
        relationship: "writes_to",
        description: "Delivers buffered records to S3",
      },
      {
        to: "redshift",
        relationship: "writes_to",
        description: "Loads streaming data into the warehouse",
      },
      {
        to: "opensearch",
        relationship: "writes_to",
        description: "Indexes streaming data for search",
      },
      {
        to: "kinesis-data-streams",
        relationship: "reads_from",
        description: "Consumes from a Kinesis data stream source",
      },
    ],
  },
  {
    id: "quicksight",
    name: "QuickSight",
    fullName: "Amazon QuickSight",
    category: "analytics",
    description:
      "Cloud-native business intelligence service for building interactive dashboards and visualizations.",
    icon: "📺",
    scope: "region",
    cfnType: "AWS::QuickSight::Dashboard",
    arnPattern: "arn:aws:quicksight:{region}:{account}:dashboard/{id}",
    keywords: ["quicksight", "bi", "dashboard", "visualization", "reporting"],
    configFields: [
      {
        key: "edition",
        label: "Edition",
        type: "select",
        default: "ENTERPRISE",
        options: [
          { value: "STANDARD", label: "Standard" },
          { value: "ENTERPRISE", label: "Enterprise" },
        ],
      },
      { key: "spice", label: "Use SPICE", type: "boolean", default: true },
    ],
    commonConnections: [
      { to: "athena", relationship: "reads_from", description: "Visualizes Athena query results" },
      {
        to: "redshift",
        relationship: "reads_from",
        description: "Queries the data warehouse for dashboards",
      },
      {
        to: "s3-bucket",
        relationship: "reads_from",
        description: "Imports datasets directly from S3",
      },
    ],
  },
  {
    id: "opensearch",
    name: "OpenSearch",
    fullName: "Amazon OpenSearch Service",
    category: "analytics",
    description:
      "Managed service for search, log analytics, and observability using OpenSearch and Elasticsearch.",
    icon: "🔭",
    scope: "vpc",
    cfnType: "AWS::OpenSearchService::Domain",
    arnPattern: "arn:aws:es:{region}:{account}:domain/{name}",
    keywords: ["opensearch", "elasticsearch", "search", "log analytics", "kibana"],
    configFields: [
      {
        key: "engineVersion",
        label: "Engine Version",
        type: "string",
        placeholder: "OpenSearch_2.11",
        default: "OpenSearch_2.11",
      },
      {
        key: "instanceType",
        label: "Instance Type",
        type: "select",
        default: "r6g.large.search",
        options: [
          { value: "t3.small.search", label: "t3.small.search" },
          { value: "m6g.large.search", label: "m6g.large.search" },
          { value: "r6g.large.search", label: "r6g.large.search" },
          { value: "c6g.large.search", label: "c6g.large.search" },
        ],
      },
      { key: "instanceCount", label: "Instance Count", type: "number", default: 3 },
      { key: "dedicatedMaster", label: "Dedicated Master Nodes", type: "boolean", default: true },
    ],
    commonConnections: [
      {
        to: "kinesis-firehose",
        relationship: "reads_from",
        description: "Ingests streaming data delivered by Firehose",
      },
      {
        to: "cloudwatch-logs",
        relationship: "reads_from",
        description: "Indexes exported log data",
      },
      { to: "kms", relationship: "depends_on", description: "Encrypts the domain at rest" },
    ],
  },
  {
    id: "lake-formation",
    name: "Lake Formation",
    fullName: "AWS Lake Formation",
    category: "analytics",
    description:
      "Service that simplifies building, securing, and governing data lakes with fine-grained permissions.",
    icon: "🏞️",
    scope: "region",
    cfnType: "AWS::LakeFormation::Resource",
    arnPattern: "arn:aws:lakeformation:{region}:{account}:resource/{id}",
    keywords: ["lake formation", "data lake", "governance", "permissions", "catalog"],
    configFields: [
      {
        key: "permissionMode",
        label: "Permission Mode",
        type: "select",
        default: "lake-formation",
        options: [
          { value: "lake-formation", label: "Lake Formation" },
          { value: "iam", label: "IAM Access Control" },
        ],
      },
      {
        key: "dataLakeLocation",
        label: "Data Lake Location",
        type: "string",
        placeholder: "s3://my-data-lake/",
      },
    ],
    commonConnections: [
      {
        to: "s3-bucket",
        relationship: "depends_on",
        description: "Registers and governs S3 data lake locations",
      },
      { to: "glue", relationship: "depends_on", description: "Secures the Glue Data Catalog" },
      {
        to: "iam-role",
        relationship: "grants",
        description: "Grants fine-grained data lake permissions",
      },
    ],
  },
  {
    id: "msk",
    name: "MSK",
    fullName: "Amazon Managed Streaming for Apache Kafka",
    abbreviation: "MSK",
    category: "analytics",
    description:
      "Fully managed Apache Kafka service for building real-time streaming data pipelines.",
    icon: "📩",
    scope: "vpc",
    cfnType: "AWS::MSK::Cluster",
    arnPattern: "arn:aws:kafka:{region}:{account}:cluster/{name}/{id}",
    keywords: ["msk", "kafka", "streaming", "broker", "real-time"],
    configFields: [
      {
        key: "kafkaVersion",
        label: "Kafka Version",
        type: "string",
        placeholder: "3.6.0",
        default: "3.6.0",
      },
      {
        key: "brokerInstanceType",
        label: "Broker Instance Type",
        type: "select",
        default: "kafka.m5.large",
        options: [
          { value: "kafka.t3.small", label: "kafka.t3.small" },
          { value: "kafka.m5.large", label: "kafka.m5.large" },
          { value: "kafka.m5.xlarge", label: "kafka.m5.xlarge" },
          { value: "kafka.m5.2xlarge", label: "kafka.m5.2xlarge" },
        ],
      },
      { key: "numberOfBrokerNodes", label: "Broker Nodes", type: "number", default: 3 },
      {
        key: "encryptionInTransit",
        label: "Encryption In Transit",
        type: "boolean",
        default: true,
      },
    ],
    commonConnections: [
      {
        to: "lambda",
        relationship: "invokes",
        description: "Triggers Lambda consumers from topics",
      },
      {
        to: "kinesis-firehose",
        relationship: "writes_to",
        description: "Delivers topic records to Firehose",
      },
      { to: "kms", relationship: "depends_on", description: "Encrypts broker data at rest" },
    ],
  },
];

export default analytics;
