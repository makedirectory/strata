/**
 * Google Cloud — Application Integration & Messaging service catalog.
 */
import type { ServiceDefinition } from "../../aws/types";

const integration: ServiceDefinition[] = [
  {
    id: "gcp-pubsub-topic",
    name: "Pub/Sub Topic",
    fullName: "Google Cloud Pub/Sub Topic",
    provider: "gcp",
    category: "integration",
    description: "A named channel to which publishers send asynchronous messages.",
    icon: "📣",
    scope: "global",
    nativeType: "pubsub.googleapis.com/Topic",
    keywords: ["pubsub", "topic", "messaging", "events", "stream"],
    configFields: [
      {
        key: "messageRetentionDuration",
        label: "Message Retention",
        type: "string",
        placeholder: "604800s",
      },
      {
        key: "messageStoragePolicy",
        label: "Storage Policy",
        type: "select",
        default: "global",
        options: [
          { value: "global", label: "Global" },
          { value: "regional", label: "Restricted Regions" },
        ],
      },
    ],
    commonConnections: [
      {
        to: "gcp-pubsub-subscription",
        relationship: "contains",
        description: "Topic has subscriptions",
      },
      { to: "gcp-cloud-functions", relationship: "invokes" },
    ],
  },
  {
    id: "gcp-pubsub-subscription",
    name: "Pub/Sub Subscription",
    fullName: "Google Cloud Pub/Sub Subscription",
    provider: "gcp",
    category: "integration",
    description: "A consumer attachment that delivers messages from a topic.",
    icon: "📥",
    scope: "global",
    nativeType: "pubsub.googleapis.com/Subscription",
    keywords: ["pubsub", "subscription", "consumer", "pull", "push"],
    configFields: [
      {
        key: "deliveryType",
        label: "Delivery Type",
        type: "select",
        default: "pull",
        options: [
          { value: "pull", label: "Pull" },
          { value: "push", label: "Push" },
        ],
      },
      { key: "ackDeadlineSeconds", label: "Ack Deadline (s)", type: "number", default: 10 },
      {
        key: "enableExactlyOnceDelivery",
        label: "Exactly-Once Delivery",
        type: "boolean",
        default: false,
      },
    ],
    commonConnections: [
      { to: "gcp-pubsub-topic", relationship: "subscribes_to" },
      { to: "gcp-cloud-run", relationship: "invokes" },
    ],
  },
  {
    id: "gcp-cloud-tasks",
    name: "Cloud Tasks",
    fullName: "Google Cloud Tasks Queue",
    provider: "gcp",
    category: "integration",
    description: "Managed queue for distributed, asynchronous task execution.",
    icon: "🗂️",
    scope: "region",
    nativeType: "cloudtasks.googleapis.com/Queue",
    keywords: ["cloud tasks", "queue", "async", "tasks"],
    configFields: [
      { key: "maxDispatchesPerSecond", label: "Max Dispatches/s", type: "number", default: 500 },
      { key: "maxConcurrentDispatches", label: "Max Concurrent", type: "number", default: 1000 },
      { key: "maxAttempts", label: "Max Attempts", type: "number", default: 100 },
    ],
    commonConnections: [
      { to: "gcp-cloud-run", relationship: "invokes" },
      { to: "gcp-cloud-functions", relationship: "invokes" },
    ],
  },
  {
    id: "gcp-workflows",
    name: "Workflows",
    fullName: "Google Cloud Workflows",
    provider: "gcp",
    category: "integration",
    description: "Serverless orchestration that connects services into workflows.",
    icon: "🔀",
    scope: "region",
    nativeType: "workflows.googleapis.com/Workflow",
    keywords: ["workflows", "orchestration", "serverless", "steps"],
    configFields: [
      {
        key: "callLogLevel",
        label: "Call Log Level",
        type: "select",
        default: "LOG_ALL_CALLS",
        options: [
          { value: "LOG_ALL_CALLS", label: "Log All Calls" },
          { value: "LOG_ERRORS_ONLY", label: "Errors Only" },
          { value: "LOG_NONE", label: "None" },
        ],
      },
      {
        key: "serviceAccount",
        label: "Service Account",
        type: "string",
        placeholder: "wf-sa@project.iam.gserviceaccount.com",
      },
    ],
    commonConnections: [
      { to: "gcp-cloud-functions", relationship: "invokes" },
      { to: "gcp-cloud-run", relationship: "invokes" },
    ],
  },
  {
    id: "gcp-eventarc",
    name: "Eventarc",
    fullName: "Google Cloud Eventarc Trigger",
    provider: "gcp",
    category: "integration",
    description: "Routes events from Google services and custom sources to handlers.",
    icon: "🪝",
    scope: "region",
    nativeType: "eventarc.googleapis.com/Trigger",
    keywords: ["eventarc", "trigger", "events", "cloudevents"],
    configFields: [
      {
        key: "eventType",
        label: "Event Type",
        type: "string",
        placeholder: "google.cloud.storage.object.v1.finalized",
      },
      {
        key: "serviceAccount",
        label: "Service Account",
        type: "string",
        placeholder: "ea-sa@project.iam.gserviceaccount.com",
      },
    ],
    commonConnections: [
      { to: "gcp-cloud-run", relationship: "invokes" },
      { to: "gcp-pubsub-topic", relationship: "subscribes_to" },
    ],
  },
];

export default integration;
