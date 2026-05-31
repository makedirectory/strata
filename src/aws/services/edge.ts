/**
 * Edge & Content Delivery service catalog.
 * Every entry is a `ServiceDefinition` and the array is the default export,
 * following the canonical networking.ts catalog.
 */
import type { ServiceDefinition } from "../types";

const edge: ServiceDefinition[] = [
  {
    id: "cloudfront",
    name: "CloudFront",
    fullName: "Amazon CloudFront",
    category: "edge",
    description:
      "Global content delivery network that caches and serves content from edge locations.",
    icon: "🌐",
    scope: "global",
    cfnType: "AWS::CloudFront::Distribution",
    arnPattern: "arn:aws:cloudfront::{account}:distribution/{id}",
    keywords: ["cdn", "cloudfront", "edge", "cache", "distribution"],
    configFields: [
      {
        key: "priceClass",
        label: "Price Class",
        type: "select",
        default: "PriceClass_All",
        options: [
          { value: "PriceClass_All", label: "All Edge Locations" },
          { value: "PriceClass_200", label: "US, Europe, Asia, ME, Africa" },
          { value: "PriceClass_100", label: "US, Canada, Europe" },
        ],
      },
      {
        key: "viewerProtocolPolicy",
        label: "Viewer Protocol Policy",
        type: "select",
        default: "redirect-to-https",
        options: [
          { value: "allow-all", label: "Allow All" },
          { value: "https-only", label: "HTTPS Only" },
          { value: "redirect-to-https", label: "Redirect to HTTPS" },
        ],
      },
      {
        key: "defaultRootObject",
        label: "Default Root Object",
        type: "string",
        placeholder: "index.html",
      },
      { key: "enabled", label: "Enabled", type: "boolean", default: true },
    ],
    commonConnections: [
      {
        to: "s3-bucket",
        relationship: "reads_from",
        description: "Origin bucket for static content",
      },
      {
        to: "elastic-load-balancer",
        relationship: "routes_to",
        description: "Custom origin behind a load balancer",
      },
      { to: "lambda-edge", relationship: "invokes", description: "Runs functions at the edge" },
      { to: "waf", relationship: "attached_to", description: "Web ACL protects the distribution" },
    ],
  },
  {
    id: "global-accelerator",
    name: "Global Accelerator",
    fullName: "AWS Global Accelerator",
    abbreviation: "AGA",
    category: "edge",
    description:
      "Improves availability and performance by routing traffic over the AWS global network via anycast IPs.",
    icon: "🚄",
    scope: "global",
    cfnType: "AWS::GlobalAccelerator::Accelerator",
    arnPattern: "arn:aws:globalaccelerator::{account}:accelerator/{id}",
    keywords: ["accelerator", "anycast", "edge", "global", "performance"],
    configFields: [
      {
        key: "ipAddressType",
        label: "IP Address Type",
        type: "select",
        default: "IPV4",
        options: [
          { value: "IPV4", label: "IPv4" },
          { value: "DUAL_STACK", label: "Dual Stack" },
        ],
      },
      {
        key: "protocol",
        label: "Listener Protocol",
        type: "select",
        default: "TCP",
        options: [
          { value: "TCP", label: "TCP" },
          { value: "UDP", label: "UDP" },
        ],
      },
      { key: "enabled", label: "Enabled", type: "boolean", default: true },
    ],
    commonConnections: [
      {
        to: "elastic-load-balancer",
        relationship: "routes_to",
        description: "Forwards traffic to a load balancer endpoint",
      },
      { to: "ec2-instance", relationship: "routes_to", description: "Routes to EC2 endpoints" },
    ],
  },
  {
    id: "lambda-edge",
    name: "Lambda@Edge",
    fullName: "Amazon CloudFront Lambda@Edge",
    category: "edge",
    description:
      "Runs Lambda functions at CloudFront edge locations to customize content close to users.",
    icon: "🌩️",
    scope: "global",
    cfnType: "AWS::Lambda::Function",
    arnPattern: "arn:aws:lambda:{region}:{account}:function:{name}",
    keywords: ["lambda", "edge", "function", "cloudfront", "serverless"],
    configFields: [
      {
        key: "eventType",
        label: "CloudFront Event",
        type: "select",
        default: "viewer-request",
        options: [
          { value: "viewer-request", label: "Viewer Request" },
          { value: "origin-request", label: "Origin Request" },
          { value: "origin-response", label: "Origin Response" },
          { value: "viewer-response", label: "Viewer Response" },
        ],
      },
      {
        key: "runtime",
        label: "Runtime",
        type: "select",
        default: "nodejs20.x",
        options: [
          { value: "nodejs20.x", label: "Node.js 20.x" },
          { value: "nodejs18.x", label: "Node.js 18.x" },
          { value: "python3.12", label: "Python 3.12" },
        ],
      },
      { key: "memory", label: "Memory (MB)", type: "number", default: 128 },
      { key: "timeout", label: "Timeout (s)", type: "number", default: 5 },
    ],
    commonConnections: [
      {
        to: "cloudfront",
        relationship: "attached_to",
        description: "Associated with a CloudFront distribution",
      },
      { to: "iam-role", relationship: "assumes", description: "Execution role for the function" },
      {
        to: "cloudwatch-logs",
        relationship: "writes_to",
        description: "Writes logs to CloudWatch",
      },
    ],
  },
];

export default edge;
