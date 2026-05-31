/**
 * AWS service categories — presentation + grouping metadata.
 * Colours feed the renderer, legend and palette section headers.
 */
import type {
  CategoryDefinition,
  ServiceCategoryId,
  RelationshipDefinition,
  RelationshipKind,
} from "./types";

export const CATEGORIES: Readonly<Record<ServiceCategoryId, CategoryDefinition>> = {
  networking: {
    id: "networking",
    name: "Networking & Content Delivery",
    description: "VPCs, subnets, routing, gateways and DNS.",
    color: "#4fd1c5",
    icon: "🌐",
  },
  compute: {
    id: "compute",
    name: "Compute",
    description: "Virtual machines, serverless functions and batch.",
    color: "#f59e0b",
    icon: "🖥️",
  },
  containers: {
    id: "containers",
    name: "Containers",
    description: "Container orchestration and registries.",
    color: "#fb923c",
    icon: "📦",
  },
  storage: {
    id: "storage",
    name: "Storage",
    description: "Object, block and file storage.",
    color: "#34d399",
    icon: "🗄️",
  },
  database: {
    id: "database",
    name: "Database",
    description: "Relational, NoSQL, in-memory and graph databases.",
    color: "#10b981",
    icon: "🛢️",
  },
  integration: {
    id: "integration",
    name: "Application Integration",
    description: "Queues, topics, event buses, streams and API gateways.",
    color: "#a78bfa",
    icon: "🔀",
  },
  security: {
    id: "security",
    name: "Security & Compliance",
    description: "Secrets, encryption, firewalls and threat detection.",
    color: "#f87171",
    icon: "🛡️",
  },
  identity: {
    id: "identity",
    name: "Identity & Access",
    description: "IAM users, roles, policies and federation.",
    color: "#fbbf24",
    icon: "🔑",
  },
  monitoring: {
    id: "monitoring",
    name: "Monitoring & Observability",
    description: "Metrics, logs, traces and dashboards.",
    color: "#60a5fa",
    icon: "📊",
  },
  analytics: {
    id: "analytics",
    name: "Analytics",
    description: "Data lakes, warehouses, ETL and search.",
    color: "#38bdf8",
    icon: "📈",
  },
  "ai-ml": {
    id: "ai-ml",
    name: "Machine Learning & AI",
    description: "Model training, inference and managed AI services.",
    color: "#c084fc",
    icon: "🤖",
  },
  deployment: {
    id: "deployment",
    name: "Developer Tools & Deployment",
    description: "CI/CD pipelines, infrastructure-as-code and source control.",
    color: "#818cf8",
    icon: "🚀",
  },
  management: {
    id: "management",
    name: "Management & Governance",
    description: "Accounts, organizations, config and cost governance.",
    color: "#94a3b8",
    icon: "⚙️",
  },
  edge: {
    id: "edge",
    name: "Edge & Front-End",
    description: "CDN, edge functions and global front-end delivery.",
    color: "#2dd4bf",
    icon: "📡",
  },
};

/** Ordered list for stable palette rendering. */
export const CATEGORY_ORDER: readonly ServiceCategoryId[] = [
  "networking",
  "compute",
  "containers",
  "storage",
  "database",
  "integration",
  "security",
  "identity",
  "monitoring",
  "analytics",
  "ai-ml",
  "deployment",
  "management",
  "edge",
];

export const RELATIONSHIPS: Readonly<Record<RelationshipKind, RelationshipDefinition>> = {
  contains: {
    kind: "contains",
    label: "contains",
    description: "Parent contains child resource",
    style: "solid",
  },
  attached_to: {
    kind: "attached_to",
    label: "attached to",
    description: "Resource is bound/attached to another",
    style: "solid",
  },
  routes_to: {
    kind: "routes_to",
    label: "routes to",
    description: "Network routing rule",
    style: "solid",
  },
  depends_on: {
    kind: "depends_on",
    label: "depends on",
    description: "Generic logical dependency",
    style: "dashed",
  },
  allows: {
    kind: "allows",
    label: "allows",
    description: "Security rule grants access",
    style: "dashed",
  },
  targets: {
    kind: "targets",
    label: "targets",
    description: "Forwards traffic to a target",
    style: "solid",
  },
  reads_from: {
    kind: "reads_from",
    label: "reads from",
    description: "Reads data from",
    style: "dashed",
  },
  writes_to: {
    kind: "writes_to",
    label: "writes to",
    description: "Writes data to",
    style: "dashed",
  },
  invokes: { kind: "invokes", label: "invokes", description: "Calls / triggers", style: "solid" },
  publishes_to: {
    kind: "publishes_to",
    label: "publishes to",
    description: "Publishes messages/events to",
    style: "solid",
  },
  subscribes_to: {
    kind: "subscribes_to",
    label: "subscribes to",
    description: "Consumes messages/events from",
    style: "solid",
  },
  assumes: {
    kind: "assumes",
    label: "assumes",
    description: "Principal assumes an IAM role",
    style: "dashed",
  },
  grants: {
    kind: "grants",
    label: "grants",
    description: "Policy grants permissions",
    style: "dashed",
  },
  monitors: {
    kind: "monitors",
    label: "monitors",
    description: "Observes metrics/logs/traces",
    style: "dashed",
  },
  peers_with: {
    kind: "peers_with",
    label: "peers with",
    description: "Symmetric network peering",
    symmetric: true,
    style: "solid",
  },
  connects_to: {
    kind: "connects_to",
    label: "connects to",
    description: "Generic network connection",
    style: "solid",
  },
};

export const RELATIONSHIP_ORDER: readonly RelationshipKind[] = [
  "contains",
  "attached_to",
  "routes_to",
  "connects_to",
  "targets",
  "allows",
  "depends_on",
  "invokes",
  "publishes_to",
  "subscribes_to",
  "reads_from",
  "writes_to",
  "assumes",
  "grants",
  "monitors",
  "peers_with",
];

export function getCategory(id: ServiceCategoryId): CategoryDefinition {
  return CATEGORIES[id];
}
