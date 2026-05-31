/**
 * Management & Governance service catalog.
 * Mirrors the structure of networking.ts: every entry is a `ServiceDefinition`
 * and the array is the default export.
 */
import type { ServiceDefinition } from "../types";

const management: ServiceDefinition[] = [
  {
    id: "organizations",
    name: "Organizations",
    fullName: "AWS Organizations",
    category: "management",
    description: "Centrally governs and consolidates billing across multiple AWS accounts.",
    icon: "🏢",
    scope: "global",
    isContainer: true,
    cfnType: "AWS::Organizations::Organization",
    arnPattern: "arn:aws:organizations::{account}:organization/{id}",
    keywords: ["organizations", "accounts", "scp", "consolidated billing", "ou"],
    configFields: [
      {
        key: "featureSet",
        label: "Feature Set",
        type: "select",
        default: "ALL",
        options: [
          { value: "ALL", label: "All Features" },
          { value: "CONSOLIDATED_BILLING", label: "Consolidated Billing Only" },
        ],
      },
      {
        key: "enableSCP",
        label: "Enable Service Control Policies",
        type: "boolean",
        default: true,
      },
      {
        key: "managementAccount",
        label: "Management Account Email",
        type: "string",
        placeholder: "billing@example.com",
      },
    ],
    commonConnections: [
      {
        to: "control-tower",
        relationship: "depends_on",
        description: "Control Tower governs the organization",
      },
      {
        to: "iam-identity-center",
        relationship: "connects_to",
        description: "Provides workforce SSO across accounts",
      },
      {
        to: "aws-config",
        relationship: "monitors",
        description: "Aggregates configuration compliance",
      },
    ],
  },
  {
    id: "aws-config",
    name: "Config",
    fullName: "AWS Config",
    category: "management",
    description: "Records and evaluates resource configurations against compliance rules.",
    icon: "📋",
    scope: "region",
    cfnType: "AWS::Config::ConfigRule",
    arnPattern: "arn:aws:config:{region}:{account}:config-rule/{id}",
    keywords: ["config", "compliance", "audit", "configuration", "rules"],
    configFields: [
      {
        key: "recordAllResources",
        label: "Record All Resource Types",
        type: "boolean",
        default: true,
      },
      {
        key: "deliveryBucket",
        label: "Delivery S3 Bucket",
        type: "string",
        placeholder: "config-bucket-name",
      },
      {
        key: "ruleSource",
        label: "Rule Source",
        type: "select",
        default: "AWS",
        options: [
          { value: "AWS", label: "AWS Managed Rule" },
          { value: "CUSTOM_LAMBDA", label: "Custom (Lambda)" },
        ],
      },
    ],
    commonConnections: [
      {
        to: "s3-bucket",
        relationship: "writes_to",
        description: "Delivers configuration snapshots",
      },
      {
        to: "sns",
        relationship: "publishes_to",
        description: "Sends configuration change notifications",
      },
      { to: "lambda", relationship: "invokes", description: "Custom rule evaluation" },
      {
        to: "security-hub",
        relationship: "connects_to",
        description: "Forwards compliance findings",
      },
    ],
  },
  {
    id: "systems-manager",
    name: "Systems Manager",
    fullName: "AWS Systems Manager",
    abbreviation: "SSM",
    category: "management",
    description: "Operational hub for managing, patching and automating fleets of resources.",
    icon: "🛠️",
    scope: "region",
    cfnType: "AWS::SSM::Document",
    arnPattern: "arn:aws:ssm:{region}:{account}:document/{id}",
    keywords: ["ssm", "systems manager", "patch", "automation", "parameter store"],
    configFields: [
      {
        key: "documentType",
        label: "Document Type",
        type: "select",
        default: "Command",
        options: [
          { value: "Command", label: "Command" },
          { value: "Automation", label: "Automation" },
          { value: "Session", label: "Session" },
          { value: "Patch", label: "Patch Baseline" },
        ],
      },
      { key: "scheduleExpression", label: "Schedule", type: "string", placeholder: "rate(7 days)" },
      { key: "targetTagKey", label: "Target Tag Key", type: "string", placeholder: "Environment" },
    ],
    commonConnections: [
      {
        to: "ec2-instance",
        relationship: "connects_to",
        description: "Manages and patches instances",
      },
      {
        to: "secrets-manager",
        relationship: "reads_from",
        description: "Resolves secure parameter references",
      },
      {
        to: "cloudwatch-logs",
        relationship: "writes_to",
        description: "Streams command and session logs",
      },
      { to: "iam-role", relationship: "assumes", description: "Automation execution role" },
    ],
  },
  {
    id: "cost-explorer",
    name: "Cost Explorer",
    fullName: "AWS Cost Explorer",
    category: "management",
    description: "Visualizes, analyzes and forecasts AWS spend and usage over time.",
    icon: "💰",
    scope: "global",
    cfnType: "AWS::CE::AnomalyMonitor",
    keywords: ["cost", "billing", "budgets", "spend", "forecast"],
    configFields: [
      {
        key: "granularity",
        label: "Granularity",
        type: "select",
        default: "MONTHLY",
        options: [
          { value: "DAILY", label: "Daily" },
          { value: "MONTHLY", label: "Monthly" },
          { value: "HOURLY", label: "Hourly" },
        ],
      },
      {
        key: "monitorType",
        label: "Anomaly Monitor Type",
        type: "select",
        default: "DIMENSIONAL",
        options: [
          { value: "DIMENSIONAL", label: "Dimensional" },
          { value: "CUSTOM", label: "Custom" },
        ],
      },
      {
        key: "groupBy",
        label: "Group By",
        type: "select",
        default: "SERVICE",
        options: [
          { value: "SERVICE", label: "Service" },
          { value: "ACCOUNT", label: "Linked Account" },
          { value: "TAG", label: "Tag" },
        ],
      },
    ],
    commonConnections: [
      {
        to: "organizations",
        relationship: "reads_from",
        description: "Aggregates consolidated billing",
      },
      { to: "sns", relationship: "publishes_to", description: "Anomaly alerts" },
    ],
  },
  {
    id: "control-tower",
    name: "Control Tower",
    fullName: "AWS Control Tower",
    category: "management",
    description: "Sets up and governs a secure, multi-account AWS landing zone.",
    icon: "🗼",
    scope: "global",
    cfnType: "AWS::ControlTower::EnabledControl",
    arnPattern: "arn:aws:controltower:{region}:{account}:enabledcontrol/{id}",
    keywords: ["control tower", "landing zone", "governance", "guardrails", "accounts"],
    configFields: [
      {
        key: "guardrailType",
        label: "Guardrail Type",
        type: "select",
        default: "PREVENTIVE",
        options: [
          { value: "PREVENTIVE", label: "Preventive" },
          { value: "DETECTIVE", label: "Detective" },
          { value: "PROACTIVE", label: "Proactive" },
        ],
      },
      { key: "homeRegion", label: "Home Region", type: "string", placeholder: "us-east-1" },
      { key: "logRetentionDays", label: "Log Retention (days)", type: "number", default: 365 },
    ],
    commonConnections: [
      {
        to: "organizations",
        relationship: "depends_on",
        description: "Builds on AWS Organizations",
      },
      { to: "aws-config", relationship: "monitors", description: "Detective guardrails" },
      {
        to: "iam-identity-center",
        relationship: "connects_to",
        description: "Configures account access",
      },
      { to: "cloudtrail", relationship: "monitors", description: "Audits landing zone activity" },
    ],
  },
  {
    id: "trusted-advisor",
    name: "Trusted Advisor",
    fullName: "AWS Trusted Advisor",
    category: "management",
    description: "Recommends best practices for cost, security, performance and limits.",
    icon: "✅",
    scope: "global",
    cfnType: "AWS::Support::TrustedAdvisorCheck",
    arnPattern: "arn:aws:trustedadvisor::{account}:checks/{category}/{id}",
    keywords: ["trusted advisor", "best practices", "recommendations", "checks", "optimization"],
    configFields: [
      {
        key: "checkCategory",
        label: "Check Category",
        type: "select",
        default: "cost_optimizing",
        options: [
          { value: "cost_optimizing", label: "Cost Optimization" },
          { value: "security", label: "Security" },
          { value: "fault_tolerance", label: "Fault Tolerance" },
          { value: "performance", label: "Performance" },
          { value: "service_limits", label: "Service Limits" },
        ],
      },
      { key: "refreshNotifications", label: "Email Notifications", type: "boolean", default: true },
    ],
    commonConnections: [
      {
        to: "cost-explorer",
        relationship: "connects_to",
        description: "Cost optimization findings",
      },
      {
        to: "security-hub",
        relationship: "connects_to",
        description: "Surfaces security recommendations",
      },
      { to: "cloudwatch", relationship: "monitors", description: "Service limit metrics" },
    ],
  },
];

export default management;
