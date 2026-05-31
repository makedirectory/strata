/**
 * Google Cloud — Security & Identity service catalog.
 */
import type { ServiceDefinition } from "../../aws/types";

const security: ServiceDefinition[] = [
  {
    id: "gcp-service-account",
    name: "Service Account",
    fullName: "Google Cloud IAM Service Account",
    abbreviation: "SA",
    provider: "gcp",
    category: "identity",
    description: "A non-human identity that GCP resources use to authenticate and authorize.",
    icon: "🤖",
    scope: "global",
    nativeType: "iam.googleapis.com/ServiceAccount",
    keywords: ["service account", "iam", "identity", "sa", "principal"],
    configFields: [
      { key: "accountId", label: "Account ID", type: "string", placeholder: "app-runtime" },
      { key: "displayName", label: "Display Name", type: "string", placeholder: "App Runtime SA" },
      { key: "disabled", label: "Disabled", type: "boolean", default: false },
    ],
    commonConnections: [
      {
        to: "gcp-secret-manager",
        relationship: "grants",
        description: "Granted access to secrets",
      },
      { to: "gcp-cloud-storage", relationship: "grants" },
    ],
  },
  {
    id: "gcp-secret-manager",
    name: "Secret Manager",
    fullName: "Google Cloud Secret Manager Secret",
    provider: "gcp",
    category: "security",
    description: "Securely stores API keys, passwords, certificates and other secrets.",
    icon: "🔐",
    scope: "global",
    nativeType: "secretmanager.googleapis.com/Secret",
    keywords: ["secret manager", "secrets", "credentials", "api keys"],
    configFields: [
      {
        key: "replication",
        label: "Replication Policy",
        type: "select",
        default: "automatic",
        options: [
          { value: "automatic", label: "Automatic" },
          { value: "user-managed", label: "User-Managed" },
        ],
      },
      { key: "rotationPeriod", label: "Rotation Period", type: "string", placeholder: "2592000s" },
    ],
    commonConnections: [
      {
        to: "gcp-cloud-kms-cryptokey",
        relationship: "depends_on",
        description: "Encrypted with a CMEK key",
      },
    ],
  },
  {
    id: "gcp-cloud-kms-keyring",
    name: "KMS KeyRing",
    fullName: "Google Cloud KMS Key Ring",
    abbreviation: "KMS",
    provider: "gcp",
    category: "security",
    description: "A logical grouping of cryptographic keys in Cloud KMS.",
    icon: "🗝️",
    scope: "region",
    nativeType: "cloudkms.googleapis.com/KeyRing",
    keywords: ["kms", "key ring", "encryption", "keys"],
    configFields: [
      { key: "location", label: "Location", type: "string", placeholder: "us-central1" },
    ],
    commonConnections: [
      {
        to: "gcp-cloud-kms-cryptokey",
        relationship: "contains",
        description: "Key ring contains crypto keys",
      },
    ],
  },
  {
    id: "gcp-cloud-kms-cryptokey",
    name: "KMS CryptoKey",
    fullName: "Google Cloud KMS Crypto Key",
    provider: "gcp",
    category: "security",
    description: "A cryptographic key used to encrypt and decrypt data.",
    icon: "🔑",
    scope: "region",
    nativeType: "cloudkms.googleapis.com/CryptoKey",
    keywords: ["kms", "crypto key", "encryption", "cmek"],
    configFields: [
      {
        key: "purpose",
        label: "Purpose",
        type: "select",
        default: "ENCRYPT_DECRYPT",
        options: [
          { value: "ENCRYPT_DECRYPT", label: "Encrypt / Decrypt" },
          { value: "ASYMMETRIC_SIGN", label: "Asymmetric Sign" },
          { value: "ASYMMETRIC_DECRYPT", label: "Asymmetric Decrypt" },
        ],
      },
      { key: "rotationPeriod", label: "Rotation Period", type: "string", placeholder: "7776000s" },
      {
        key: "protectionLevel",
        label: "Protection Level",
        type: "select",
        default: "SOFTWARE",
        options: [
          { value: "SOFTWARE", label: "Software" },
          { value: "HSM", label: "HSM" },
        ],
      },
    ],
    commonConnections: [
      { to: "gcp-cloud-kms-keyring", relationship: "attached_to" },
      {
        to: "gcp-cloud-storage",
        relationship: "grants",
        description: "Used as CMEK for bucket encryption",
      },
    ],
  },
];

export default security;
