/**
 * Identity & Access Management service catalog.
 * Every entry is a `ServiceDefinition` and the array is the default export,
 * mirroring the structure of networking.ts.
 */
import type { ServiceDefinition } from "../types";

const identity: ServiceDefinition[] = [
  {
    id: "iam-role",
    name: "IAM Role",
    fullName: "AWS Identity and Access Management Role",
    abbreviation: "IAM",
    category: "identity",
    description:
      "An assumable identity with permissions that trusted principals or services can take on temporarily.",
    icon: "🎭",
    scope: "global",
    cfnType: "AWS::IAM::Role",
    arnPattern: "arn:aws:iam::{account}:role/{name}",
    keywords: ["iam", "role", "assume", "trust", "sts", "permissions"],
    configFields: [
      {
        key: "roleName",
        label: "Role Name",
        type: "string",
        placeholder: "app-execution-role",
        required: true,
      },
      {
        key: "trustedService",
        label: "Trusted Principal",
        type: "select",
        default: "lambda.amazonaws.com",
        options: [
          { value: "lambda.amazonaws.com", label: "Lambda" },
          { value: "ec2.amazonaws.com", label: "EC2" },
          { value: "ecs-tasks.amazonaws.com", label: "ECS Tasks" },
          { value: "eks.amazonaws.com", label: "EKS" },
        ],
      },
      { key: "maxSessionDuration", label: "Max Session (sec)", type: "number", default: 3600 },
      {
        key: "permissionsBoundary",
        label: "Permissions Boundary",
        type: "arn",
        placeholder: "arn:aws:iam::123456789012:policy/Boundary",
      },
    ],
    commonConnections: [
      {
        to: "iam-policy",
        relationship: "grants",
        description: "Role grants permissions via attached policies",
      },
      {
        to: "lambda",
        relationship: "attached_to",
        description: "Assumed as a Lambda execution role",
      },
      {
        to: "ec2-instance",
        relationship: "attached_to",
        description: "Attached via an instance profile",
      },
    ],
  },
  {
    id: "iam-user",
    name: "IAM User",
    fullName: "AWS Identity and Access Management User",
    abbreviation: "IAM",
    category: "identity",
    description:
      "A long-lived identity representing a person or application with its own credentials.",
    icon: "👤",
    scope: "global",
    cfnType: "AWS::IAM::User",
    arnPattern: "arn:aws:iam::{account}:user/{name}",
    keywords: ["iam", "user", "credentials", "access key", "principal"],
    configFields: [
      { key: "userName", label: "User Name", type: "string", placeholder: "alice", required: true },
      {
        key: "accessType",
        label: "Access Type",
        type: "select",
        default: "programmatic",
        options: [
          { value: "programmatic", label: "Programmatic (Access Keys)" },
          { value: "console", label: "Console Password" },
          { value: "both", label: "Both" },
        ],
      },
      { key: "mfaEnabled", label: "MFA Enabled", type: "boolean", default: true },
    ],
    commonConnections: [
      { to: "iam-group", relationship: "attached_to", description: "User is a member of a group" },
      {
        to: "iam-policy",
        relationship: "grants",
        description: "Policy grants permissions directly to the user",
      },
      {
        to: "iam-role",
        relationship: "assumes",
        description: "User assumes a role for elevated access",
      },
    ],
  },
  {
    id: "iam-policy",
    name: "IAM Policy",
    fullName: "AWS Identity and Access Management Policy",
    abbreviation: "IAM",
    category: "identity",
    description:
      "A JSON document defining allow/deny permissions that can be attached to principals.",
    icon: "📜",
    scope: "global",
    cfnType: "AWS::IAM::ManagedPolicy",
    arnPattern: "arn:aws:iam::{account}:policy/{name}",
    keywords: ["iam", "policy", "permissions", "json", "allow", "deny"],
    configFields: [
      {
        key: "policyName",
        label: "Policy Name",
        type: "string",
        placeholder: "s3-read-only",
        required: true,
      },
      {
        key: "policyType",
        label: "Policy Type",
        type: "select",
        default: "managed",
        options: [
          { value: "managed", label: "Customer Managed" },
          { value: "aws-managed", label: "AWS Managed" },
          { value: "inline", label: "Inline" },
        ],
      },
      {
        key: "document",
        label: "Policy Document",
        type: "text",
        placeholder: '{ "Version": "2012-10-17", "Statement": [] }',
      },
    ],
    commonConnections: [
      {
        to: "iam-role",
        relationship: "grants",
        description: "Policy grants permissions to a role",
      },
      {
        to: "iam-user",
        relationship: "grants",
        description: "Policy grants permissions to a user",
      },
      {
        to: "iam-group",
        relationship: "grants",
        description: "Policy grants permissions to a group",
      },
    ],
  },
  {
    id: "iam-group",
    name: "IAM Group",
    fullName: "AWS Identity and Access Management Group",
    abbreviation: "IAM",
    category: "identity",
    description: "A collection of IAM users that share a common set of attached permissions.",
    icon: "👥",
    scope: "global",
    isContainer: true,
    cfnType: "AWS::IAM::Group",
    arnPattern: "arn:aws:iam::{account}:group/{name}",
    keywords: ["iam", "group", "users", "permissions", "membership"],
    configFields: [
      {
        key: "groupName",
        label: "Group Name",
        type: "string",
        placeholder: "developers",
        required: true,
      },
      { key: "path", label: "Path", type: "string", placeholder: "/", default: "/" },
    ],
    commonConnections: [
      { to: "iam-user", relationship: "contains", description: "Group contains member users" },
      {
        to: "iam-policy",
        relationship: "grants",
        description: "Policy grants permissions to all group members",
      },
    ],
  },
  {
    id: "iam-identity-center",
    name: "Identity Center",
    fullName: "AWS IAM Identity Center",
    abbreviation: "SSO",
    category: "identity",
    description:
      "Centralized workforce single sign-on and permission management across AWS accounts.",
    icon: "🪪",
    scope: "global",
    cfnType: "AWS::SSO::PermissionSet",
    arnPattern: "arn:aws:sso:::permissionSet/{instance}/{id}",
    keywords: ["sso", "identity center", "single sign-on", "permission set", "workforce"],
    configFields: [
      {
        key: "permissionSetName",
        label: "Permission Set",
        type: "string",
        placeholder: "AdministratorAccess",
        required: true,
      },
      {
        key: "identitySource",
        label: "Identity Source",
        type: "select",
        default: "identity-center",
        options: [
          { value: "identity-center", label: "Identity Center Directory" },
          { value: "active-directory", label: "Active Directory" },
          { value: "external-idp", label: "External IdP (SAML)" },
        ],
      },
      {
        key: "sessionDuration",
        label: "Session Duration",
        type: "string",
        placeholder: "PT8H",
        default: "PT1H",
      },
    ],
    commonConnections: [
      {
        to: "iam-role",
        relationship: "assumes",
        description: "Provisions and assumes roles via permission sets",
      },
      {
        to: "organizations",
        relationship: "connects_to",
        description: "Manages access across the organization",
      },
      {
        to: "iam-policy",
        relationship: "grants",
        description: "Permission set references managed policies",
      },
    ],
  },
];

export default identity;
