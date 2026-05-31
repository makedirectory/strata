/**
 * Azure Security & Identity service catalog.
 * Key Vault (security), user-assigned Managed Identity (identity, global) and
 * Cognitive Services / Azure OpenAI accounts (ai-ml).
 */
import type { ServiceDefinition } from "../../aws/types";

const security: ServiceDefinition[] = [
  {
    id: "azure-key-vault",
    name: "Key Vault",
    fullName: "Azure Key Vault",
    provider: "azure",
    category: "security",
    description: "A managed store for secrets, keys and certificates with access policies.",
    icon: "🔐",
    scope: "region",
    nativeType: "Microsoft.KeyVault/vaults",
    keywords: ["key vault", "secrets", "keys", "certificates", "hsm"],
    configFields: [
      {
        key: "sku",
        label: "SKU",
        type: "select",
        default: "standard",
        options: [
          { value: "standard", label: "Standard" },
          { value: "premium", label: "Premium (HSM)" },
        ],
      },
      {
        key: "enableRbacAuthorization",
        label: "RBAC Authorization",
        type: "boolean",
        default: true,
      },
      { key: "enableSoftDelete", label: "Soft Delete", type: "boolean", default: true },
      { key: "enablePurgeProtection", label: "Purge Protection", type: "boolean", default: false },
    ],
    commonConnections: [{ to: "azure-managed-identity", relationship: "grants" }],
  },
  {
    id: "azure-managed-identity",
    name: "Managed Identity",
    fullName: "Azure User-Assigned Managed Identity",
    provider: "azure",
    category: "identity",
    description: "An Entra ID identity that Azure resources use to authenticate.",
    icon: "🪪",
    scope: "global",
    nativeType: "Microsoft.ManagedIdentity/userAssignedIdentities",
    keywords: ["managed identity", "identity", "entra", "rbac", "msi"],
    configFields: [
      {
        key: "name",
        label: "Identity Name",
        type: "string",
        placeholder: "app-identity",
        required: true,
      },
      { key: "tags", label: "Tags", type: "tags" },
    ],
    commonConnections: [
      { to: "azure-key-vault", relationship: "grants" },
      { to: "azure-storage-account", relationship: "grants" },
    ],
  },
  {
    id: "azure-cognitive-services",
    name: "Azure OpenAI",
    fullName: "Azure Cognitive Services Account (Azure OpenAI)",
    provider: "azure",
    category: "ai-ml",
    description: "A managed endpoint for OpenAI and Cognitive Services AI models.",
    icon: "🤖",
    scope: "region",
    nativeType: "Microsoft.CognitiveServices/accounts",
    keywords: ["azure openai", "cognitive services", "ai", "gpt", "embeddings"],
    configFields: [
      {
        key: "kind",
        label: "Account Kind",
        type: "select",
        default: "OpenAI",
        options: [
          { value: "OpenAI", label: "Azure OpenAI" },
          { value: "CognitiveServices", label: "Cognitive Services (multi)" },
          { value: "ComputerVision", label: "Computer Vision" },
          { value: "TextAnalytics", label: "Language" },
        ],
      },
      {
        key: "sku",
        label: "SKU",
        type: "select",
        default: "S0",
        options: [
          { value: "F0", label: "Free (F0)" },
          { value: "S0", label: "Standard (S0)" },
        ],
      },
      {
        key: "customSubDomain",
        label: "Custom Subdomain",
        type: "string",
        placeholder: "my-openai",
      },
    ],
    commonConnections: [
      { to: "azure-managed-identity", relationship: "grants" },
      { to: "azure-key-vault", relationship: "reads_from" },
    ],
  },
];

export default security;
