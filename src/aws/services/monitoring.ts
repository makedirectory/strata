/**
 * Management & Governance — Monitoring & Observability service catalog.
 * Every entry is a `ServiceDefinition` and the array is the default export,
 * mirroring the structure of networking.ts.
 */
import type { ServiceDefinition } from "../types";

const monitoring: ServiceDefinition[] = [
  {
    id: "cloudwatch",
    name: "CloudWatch",
    fullName: "Amazon CloudWatch",
    category: "monitoring",
    description: "Collects metrics, dashboards and events for AWS resources and applications.",
    icon: "📊",
    scope: "region",
    cfnType: "AWS::CloudWatch::Dashboard",
    arnPattern: "arn:aws:cloudwatch:{region}:{account}:dashboard/{name}",
    keywords: ["cloudwatch", "metrics", "monitoring", "dashboard", "observability"],
    configFields: [
      {
        key: "namespace",
        label: "Namespace",
        type: "string",
        placeholder: "AWS/EC2",
        default: "AWS/EC2",
      },
      { key: "detailedMonitoring", label: "Detailed Monitoring", type: "boolean", default: false },
      {
        key: "period",
        label: "Period (seconds)",
        type: "select",
        default: "300",
        options: [
          { value: "60", label: "1 minute" },
          { value: "300", label: "5 minutes" },
          { value: "900", label: "15 minutes" },
        ],
      },
    ],
    commonConnections: [
      { to: "ec2-instance", relationship: "monitors", description: "Collects metrics from EC2" },
      { to: "cloudwatch-alarm", relationship: "publishes_to", description: "Metrics drive alarms" },
      { to: "cloudwatch-logs", relationship: "writes_to", description: "Stores log streams" },
    ],
  },
  {
    id: "cloudwatch-logs",
    name: "CloudWatch Logs",
    fullName: "Amazon CloudWatch Logs",
    category: "monitoring",
    description: "Centralized, searchable log storage and streaming for applications and services.",
    icon: "🗒️",
    scope: "region",
    cfnType: "AWS::Logs::LogGroup",
    arnPattern: "arn:aws:logs:{region}:{account}:log-group:{name}",
    keywords: ["logs", "log group", "cloudwatch", "logging", "insights"],
    configFields: [
      {
        key: "logGroupName",
        label: "Log Group Name",
        type: "string",
        placeholder: "/aws/lambda/my-fn",
        required: true,
      },
      {
        key: "retentionDays",
        label: "Retention",
        type: "select",
        default: "30",
        options: [
          { value: "7", label: "1 week" },
          { value: "30", label: "1 month" },
          { value: "90", label: "3 months" },
          { value: "365", label: "1 year" },
          { value: "0", label: "Never expire" },
        ],
      },
      { key: "encrypted", label: "KMS Encryption", type: "boolean", default: false },
    ],
    commonConnections: [
      {
        to: "cloudwatch-alarm",
        relationship: "publishes_to",
        description: "Metric filters raise alarms",
      },
      {
        to: "kinesis-firehose",
        relationship: "writes_to",
        description: "Subscription filter to Firehose",
      },
      { to: "s3-bucket", relationship: "writes_to", description: "Export logs to S3" },
    ],
  },
  {
    id: "cloudwatch-alarm",
    name: "CloudWatch Alarm",
    fullName: "Amazon CloudWatch Alarm",
    category: "monitoring",
    description: "Watches a metric and triggers actions when it crosses a defined threshold.",
    icon: "🚨",
    scope: "region",
    cfnType: "AWS::CloudWatch::Alarm",
    arnPattern: "arn:aws:cloudwatch:{region}:{account}:alarm:{name}",
    keywords: ["alarm", "alert", "threshold", "cloudwatch", "notify"],
    configFields: [
      {
        key: "metricName",
        label: "Metric Name",
        type: "string",
        placeholder: "CPUUtilization",
        required: true,
      },
      {
        key: "comparisonOperator",
        label: "Comparison",
        type: "select",
        default: "GreaterThanThreshold",
        options: [
          { value: "GreaterThanThreshold", label: "Greater than" },
          { value: "GreaterThanOrEqualToThreshold", label: "Greater than or equal" },
          { value: "LessThanThreshold", label: "Less than" },
          { value: "LessThanOrEqualToThreshold", label: "Less than or equal" },
        ],
      },
      { key: "threshold", label: "Threshold", type: "number", default: 80 },
      { key: "evaluationPeriods", label: "Evaluation Periods", type: "number", default: 1 },
    ],
    commonConnections: [
      { to: "sns", relationship: "publishes_to", description: "Notify via SNS topic" },
      { to: "auto-scaling-group", relationship: "invokes", description: "Trigger scaling action" },
    ],
  },
  {
    id: "x-ray",
    name: "X-Ray",
    fullName: "AWS X-Ray",
    category: "monitoring",
    description: "Distributed tracing that analyzes and debugs requests across microservices.",
    icon: "🔬",
    scope: "region",
    cfnType: "AWS::XRay::Group",
    arnPattern: "arn:aws:xray:{region}:{account}:group/{name}",
    keywords: ["x-ray", "tracing", "distributed", "trace", "latency"],
    configFields: [
      {
        key: "samplingRate",
        label: "Sampling Rate",
        type: "number",
        default: 0.05,
        help: "Fraction of requests traced (0-1)",
      },
      { key: "insightsEnabled", label: "Insights Enabled", type: "boolean", default: true },
    ],
    commonConnections: [
      { to: "lambda", relationship: "monitors", description: "Traces Lambda invocations" },
      { to: "api-gateway", relationship: "monitors", description: "Traces API requests" },
      {
        to: "ecs-service",
        relationship: "monitors",
        description: "Traces container service requests",
      },
    ],
  },
  {
    id: "cloudtrail",
    name: "CloudTrail",
    fullName: "AWS CloudTrail",
    category: "monitoring",
    description: "Records account activity and API calls for governance, audit and compliance.",
    icon: "🧾",
    scope: "region",
    cfnType: "AWS::CloudTrail::Trail",
    arnPattern: "arn:aws:cloudtrail:{region}:{account}:trail/{name}",
    keywords: ["cloudtrail", "audit", "api", "governance", "compliance"],
    configFields: [
      {
        key: "trailName",
        label: "Trail Name",
        type: "string",
        placeholder: "org-management-trail",
        required: true,
      },
      { key: "multiRegion", label: "Multi-Region Trail", type: "boolean", default: true },
      { key: "logFileValidation", label: "Log File Validation", type: "boolean", default: true },
      {
        key: "eventType",
        label: "Event Type",
        type: "select",
        default: "Management",
        options: [
          { value: "Management", label: "Management Events" },
          { value: "Data", label: "Data Events" },
          { value: "Insights", label: "Insights Events" },
        ],
      },
    ],
    commonConnections: [
      { to: "s3-bucket", relationship: "writes_to", description: "Delivers logs to an S3 bucket" },
      {
        to: "cloudwatch-logs",
        relationship: "writes_to",
        description: "Streams events to CloudWatch Logs",
      },
      { to: "guardduty", relationship: "publishes_to", description: "Feeds threat detection" },
    ],
  },
];

export default monitoring;
