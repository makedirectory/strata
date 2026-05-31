/**
 * Azure Integration service catalog.
 * Messaging (Service Bus, Event Hub, Storage Queue), eventing (Event Grid)
 * and workflow orchestration (Logic Apps).
 */
import type { ServiceDefinition } from "../../aws/types";

const integration: ServiceDefinition[] = [
  {
    id: "azure-service-bus",
    name: "Service Bus",
    fullName: "Azure Service Bus Namespace",
    provider: "azure",
    category: "integration",
    description: "Enterprise messaging with queues and publish/subscribe topics.",
    icon: "🚌",
    scope: "region",
    nativeType: "Microsoft.ServiceBus/namespaces",
    keywords: ["service bus", "messaging", "queue", "topic", "pubsub"],
    configFields: [
      {
        key: "sku",
        label: "Tier",
        type: "select",
        default: "Standard",
        options: [
          { value: "Basic", label: "Basic" },
          { value: "Standard", label: "Standard" },
          { value: "Premium", label: "Premium" },
        ],
      },
      { key: "zoneRedundant", label: "Zone Redundant", type: "boolean", default: false },
    ],
    commonConnections: [{ to: "azure-functions", relationship: "invokes" }],
  },
  {
    id: "azure-event-hub",
    name: "Event Hub",
    fullName: "Azure Event Hubs Namespace",
    provider: "azure",
    category: "integration",
    description: "A high-throughput event streaming and ingestion platform.",
    icon: "📡",
    scope: "region",
    nativeType: "Microsoft.EventHub/namespaces",
    keywords: ["event hub", "streaming", "ingestion", "kafka"],
    configFields: [
      {
        key: "sku",
        label: "Tier",
        type: "select",
        default: "Standard",
        options: [
          { value: "Basic", label: "Basic" },
          { value: "Standard", label: "Standard" },
          { value: "Premium", label: "Premium" },
        ],
      },
      { key: "throughputUnits", label: "Throughput Units", type: "number", default: 1 },
    ],
    commonConnections: [
      { to: "azure-functions", relationship: "invokes" },
      { to: "azure-stream-analytics", relationship: "publishes_to" },
    ],
  },
  {
    id: "azure-event-grid",
    name: "Event Grid",
    fullName: "Azure Event Grid Topic",
    provider: "azure",
    category: "integration",
    description: "A serverless event routing service for reactive architectures.",
    icon: "🔔",
    scope: "region",
    nativeType: "Microsoft.EventGrid/topics",
    keywords: ["event grid", "events", "routing", "serverless"],
    configFields: [
      {
        key: "inputSchema",
        label: "Input Schema",
        type: "select",
        default: "EventGridSchema",
        options: [
          { value: "EventGridSchema", label: "Event Grid Schema" },
          { value: "CloudEventSchemaV1_0", label: "CloudEvents 1.0" },
          { value: "CustomEventSchema", label: "Custom Schema" },
        ],
      },
      {
        key: "publicNetworkAccess",
        label: "Public Network Access",
        type: "boolean",
        default: true,
      },
    ],
    commonConnections: [
      { to: "azure-functions", relationship: "invokes" },
      { to: "azure-logic-app", relationship: "invokes" },
    ],
  },
  {
    id: "azure-logic-app",
    name: "Logic App",
    fullName: "Azure Logic Apps Workflow",
    provider: "azure",
    category: "integration",
    description: "A low-code workflow engine for integrating apps, data and services.",
    icon: "🧩",
    scope: "region",
    nativeType: "Microsoft.Logic/workflows",
    keywords: ["logic app", "workflow", "integration", "low-code"],
    configFields: [
      {
        key: "state",
        label: "State",
        type: "select",
        default: "Enabled",
        options: [
          { value: "Enabled", label: "Enabled" },
          { value: "Disabled", label: "Disabled" },
        ],
      },
      {
        key: "definition",
        label: "Workflow Definition",
        type: "text",
        placeholder: "{ ...JSON... }",
      },
    ],
    commonConnections: [
      { to: "azure-service-bus", relationship: "publishes_to" },
      { to: "azure-sql-database", relationship: "writes_to" },
    ],
  },
  {
    id: "azure-storage-queue",
    name: "Storage Queue",
    fullName: "Azure Storage Queue",
    provider: "azure",
    category: "integration",
    description: "A simple, durable message queue backed by a storage account.",
    icon: "📥",
    scope: "region",
    nativeType: "Microsoft.Storage/storageAccounts/queueServices/queues",
    keywords: ["storage queue", "queue", "messaging"],
    configFields: [
      { key: "name", label: "Queue Name", type: "string", placeholder: "jobs", required: true },
      { key: "metadata", label: "Metadata", type: "tags" },
    ],
    commonConnections: [{ to: "azure-functions", relationship: "invokes" }],
  },
];

export default integration;
