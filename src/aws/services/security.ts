/**
 * Security, Identity & Compliance service catalog.
 * Every entry is a `ServiceDefinition` and the array is the default export,
 * mirroring the structure of networking.ts.
 */
import type { ServiceDefinition } from "../types";

const security: ServiceDefinition[] = [
  {
    id: "secrets-manager",
    name: "Secrets Manager",
    fullName: "AWS Secrets Manager",
    category: "security",
    description:
      "Stores, rotates, and retrieves database credentials, API keys, and other secrets.",
    icon: "🔑",
    scope: "region",
    cfnType: "AWS::SecretsManager::Secret",
    arnPattern: "arn:aws:secretsmanager:{region}:{account}:secret:{name}",
    keywords: ["secrets", "credentials", "rotation", "password", "api key"],
    configFields: [
      {
        key: "secretName",
        label: "Secret Name",
        type: "string",
        placeholder: "prod/db/password",
        required: true,
      },
      { key: "rotationEnabled", label: "Automatic Rotation", type: "boolean", default: false },
      { key: "rotationDays", label: "Rotation Interval (days)", type: "number", default: 30 },
      {
        key: "kmsKeyId",
        label: "Encryption Key",
        type: "select",
        default: "aws-managed",
        options: [
          { value: "aws-managed", label: "AWS managed key" },
          { value: "customer-managed", label: "Customer managed (KMS)" },
        ],
      },
    ],
    commonConnections: [
      {
        to: "kms",
        relationship: "depends_on",
        description: "Secrets are encrypted with a KMS key",
      },
      { to: "lambda", relationship: "invokes", description: "Lambda performs secret rotation" },
      { to: "rds", relationship: "writes_to", description: "Rotates database credentials" },
    ],
  },
  {
    id: "kms",
    name: "KMS",
    fullName: "AWS Key Management Service",
    abbreviation: "KMS",
    category: "security",
    description:
      "Creates and controls cryptographic keys used to encrypt data across AWS services.",
    icon: "🔐",
    scope: "region",
    cfnType: "AWS::KMS::Key",
    arnPattern: "arn:aws:kms:{region}:{account}:key/{id}",
    keywords: ["kms", "encryption", "key", "cryptography", "cmk"],
    configFields: [
      {
        key: "keyType",
        label: "Key Type",
        type: "select",
        default: "symmetric",
        options: [
          { value: "symmetric", label: "Symmetric" },
          { value: "asymmetric", label: "Asymmetric" },
        ],
      },
      {
        key: "keyUsage",
        label: "Key Usage",
        type: "select",
        default: "encrypt-decrypt",
        options: [
          { value: "encrypt-decrypt", label: "Encrypt and decrypt" },
          { value: "sign-verify", label: "Sign and verify" },
        ],
      },
      { key: "rotation", label: "Automatic Key Rotation", type: "boolean", default: true },
      { key: "multiRegion", label: "Multi-Region Key", type: "boolean", default: false },
    ],
    commonConnections: [
      { to: "s3-bucket", relationship: "depends_on", description: "Encrypts S3 objects" },
      { to: "ebs-volume", relationship: "depends_on", description: "Encrypts EBS volumes" },
      {
        to: "iam-role",
        relationship: "grants",
        description: "Key policy grants usage to principals",
      },
    ],
  },
  {
    id: "waf",
    name: "WAF",
    fullName: "AWS WAF",
    abbreviation: "WAF",
    category: "security",
    description:
      "Web application firewall that filters malicious HTTP/S requests with managed and custom rules.",
    icon: "🛡️",
    scope: "region",
    cfnType: "AWS::WAFv2::WebACL",
    arnPattern: "arn:aws:wafv2:{region}:{account}:{scope}/webacl/{name}/{id}",
    keywords: ["waf", "firewall", "web", "acl", "sql injection", "xss"],
    configFields: [
      {
        key: "scope",
        label: "Scope",
        type: "select",
        default: "REGIONAL",
        options: [
          { value: "REGIONAL", label: "Regional (ALB / API GW)" },
          { value: "CLOUDFRONT", label: "CloudFront (global)" },
        ],
      },
      {
        key: "defaultAction",
        label: "Default Action",
        type: "select",
        default: "allow",
        options: [
          { value: "allow", label: "Allow" },
          { value: "block", label: "Block" },
        ],
      },
      {
        key: "managedRules",
        label: "Managed Rule Groups",
        type: "text",
        placeholder: "AWSManagedRulesCommonRuleSet",
      },
    ],
    commonConnections: [
      { to: "elastic-load-balancer", relationship: "attached_to", description: "Protects an ALB" },
      {
        to: "cloudfront",
        relationship: "attached_to",
        description: "Protects a CloudFront distribution",
      },
      {
        to: "api-gateway",
        relationship: "attached_to",
        description: "Protects an API Gateway stage",
      },
    ],
  },
  {
    id: "shield",
    name: "Shield",
    fullName: "AWS Shield",
    category: "security",
    description: "Managed DDoS protection for applications running on AWS.",
    icon: "🪖",
    scope: "global",
    cfnType: "AWS::Shield::Protection",
    keywords: ["shield", "ddos", "protection", "advanced"],
    configFields: [
      {
        key: "tier",
        label: "Tier",
        type: "select",
        default: "standard",
        options: [
          { value: "standard", label: "Standard (free)" },
          { value: "advanced", label: "Advanced" },
        ],
      },
      {
        key: "resourceArn",
        label: "Protected Resource ARN",
        type: "arn",
        placeholder: "arn:aws:cloudfront::...",
      },
    ],
    commonConnections: [
      {
        to: "cloudfront",
        relationship: "attached_to",
        description: "Protects CloudFront distributions",
      },
      {
        to: "elastic-load-balancer",
        relationship: "attached_to",
        description: "Protects load balancers",
      },
      {
        to: "global-accelerator",
        relationship: "attached_to",
        description: "Protects accelerators",
      },
    ],
  },
  {
    id: "guardduty",
    name: "GuardDuty",
    fullName: "Amazon GuardDuty",
    category: "security",
    description:
      "Threat detection service that continuously monitors accounts and workloads for malicious activity.",
    icon: "🐶",
    scope: "region",
    cfnType: "AWS::GuardDuty::Detector",
    keywords: ["guardduty", "threat", "detection", "anomaly", "findings"],
    configFields: [
      { key: "enabled", label: "Enabled", type: "boolean", default: true },
      {
        key: "findingFrequency",
        label: "Finding Publishing Frequency",
        type: "select",
        default: "SIX_HOURS",
        options: [
          { value: "FIFTEEN_MINUTES", label: "15 minutes" },
          { value: "ONE_HOUR", label: "1 hour" },
          { value: "SIX_HOURS", label: "6 hours" },
        ],
      },
      { key: "s3Protection", label: "S3 Protection", type: "boolean", default: true },
    ],
    commonConnections: [
      {
        to: "eventbridge",
        relationship: "publishes_to",
        description: "Publishes findings to EventBridge",
      },
      {
        to: "security-hub",
        relationship: "writes_to",
        description: "Sends findings to Security Hub",
      },
      { to: "cloudwatch-logs", relationship: "monitors", description: "Analyzes VPC and DNS logs" },
    ],
  },
  {
    id: "acm",
    name: "Certificate Manager",
    fullName: "AWS Certificate Manager",
    abbreviation: "ACM",
    category: "security",
    description: "Provisions, manages, and deploys public and private SSL/TLS certificates.",
    icon: "🔏",
    scope: "region",
    cfnType: "AWS::CertificateManager::Certificate",
    arnPattern: "arn:aws:acm:{region}:{account}:certificate/{id}",
    keywords: ["acm", "certificate", "tls", "ssl", "https"],
    configFields: [
      {
        key: "domainName",
        label: "Domain Name",
        type: "string",
        placeholder: "example.com",
        required: true,
      },
      {
        key: "validationMethod",
        label: "Validation Method",
        type: "select",
        default: "DNS",
        options: [
          { value: "DNS", label: "DNS validation" },
          { value: "EMAIL", label: "Email validation" },
        ],
      },
      {
        key: "subjectAlternativeNames",
        label: "Alternative Names (SANs)",
        type: "text",
        placeholder: "*.example.com",
      },
    ],
    commonConnections: [
      {
        to: "elastic-load-balancer",
        relationship: "attached_to",
        description: "Terminates TLS at the load balancer",
      },
      {
        to: "cloudfront",
        relationship: "attached_to",
        description: "Provides the viewer certificate",
      },
      {
        to: "route53",
        relationship: "depends_on",
        description: "DNS validation records in Route 53",
      },
    ],
  },
  {
    id: "cognito",
    name: "Cognito",
    fullName: "Amazon Cognito",
    category: "security",
    description: "Adds user sign-up, sign-in, and access control to web and mobile apps.",
    icon: "🧑",
    scope: "region",
    cfnType: "AWS::Cognito::UserPool",
    arnPattern: "arn:aws:cognito-idp:{region}:{account}:userpool/{id}",
    keywords: ["cognito", "auth", "user pool", "identity pool", "oauth", "login"],
    configFields: [
      {
        key: "poolType",
        label: "Pool Type",
        type: "select",
        default: "user-pool",
        options: [
          { value: "user-pool", label: "User Pool" },
          { value: "identity-pool", label: "Identity Pool" },
        ],
      },
      {
        key: "mfa",
        label: "MFA Configuration",
        type: "select",
        default: "OPTIONAL",
        options: [
          { value: "OFF", label: "Off" },
          { value: "OPTIONAL", label: "Optional" },
          { value: "ON", label: "Required" },
        ],
      },
      {
        key: "signInAlias",
        label: "Sign-in Alias",
        type: "select",
        default: "email",
        options: [
          { value: "email", label: "Email" },
          { value: "phone", label: "Phone number" },
          { value: "username", label: "Username" },
        ],
      },
    ],
    commonConnections: [
      { to: "api-gateway", relationship: "allows", description: "Authorizes API Gateway requests" },
      {
        to: "appsync",
        relationship: "allows",
        description: "Authorizes AppSync GraphQL operations",
      },
      {
        to: "iam-role",
        relationship: "assumes",
        description: "Identity pool maps users to IAM roles",
      },
    ],
  },
  {
    id: "security-hub",
    name: "Security Hub",
    fullName: "AWS Security Hub",
    category: "security",
    description:
      "Aggregates, prioritizes, and runs automated compliance checks on security findings.",
    icon: "🏥",
    scope: "region",
    cfnType: "AWS::SecurityHub::Hub",
    keywords: ["security hub", "findings", "compliance", "cspm", "standards"],
    configFields: [
      {
        key: "standards",
        label: "Enabled Standards",
        type: "multiselect",
        options: [
          { value: "cis", label: "CIS AWS Foundations" },
          { value: "pci-dss", label: "PCI DSS" },
          { value: "fsbp", label: "AWS Foundational Security Best Practices" },
        ],
      },
      {
        key: "autoEnableControls",
        label: "Auto-enable New Controls",
        type: "boolean",
        default: true,
      },
    ],
    commonConnections: [
      {
        to: "eventbridge",
        relationship: "publishes_to",
        description: "Routes findings to EventBridge",
      },
      { to: "guardduty", relationship: "reads_from", description: "Ingests GuardDuty findings" },
      { to: "inspector", relationship: "reads_from", description: "Ingests Inspector findings" },
    ],
  },
  {
    id: "inspector",
    name: "Inspector",
    fullName: "Amazon Inspector",
    category: "security",
    description:
      "Automated vulnerability management that continually scans workloads for software flaws.",
    icon: "🕵️",
    scope: "region",
    cfnType: "AWS::InspectorV2::Filter",
    keywords: ["inspector", "vulnerability", "scan", "cve", "assessment"],
    configFields: [
      { key: "scanEc2", label: "Scan EC2 Instances", type: "boolean", default: true },
      { key: "scanEcr", label: "Scan ECR Images", type: "boolean", default: true },
      { key: "scanLambda", label: "Scan Lambda Functions", type: "boolean", default: false },
    ],
    commonConnections: [
      {
        to: "ec2-instance",
        relationship: "monitors",
        description: "Scans EC2 instances for vulnerabilities",
      },
      { to: "ecr", relationship: "monitors", description: "Scans container images in ECR" },
      {
        to: "security-hub",
        relationship: "writes_to",
        description: "Sends findings to Security Hub",
      },
    ],
  },
];

export default security;
