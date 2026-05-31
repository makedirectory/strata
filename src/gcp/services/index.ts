/**
 * Google Cloud service catalog — aggregator.
 * ------------------------------------------
 * Mirrors the AWS catalog layout (`src/aws/services/*.ts`): each category file
 * default-exports a `ServiceDefinition[]` with `provider: "gcp"` and a
 * Cloud Asset Inventory `nativeType` (e.g. "compute.googleapis.com/Instance").
 * The registry flattens this list alongside AWS and Azure.
 */
import type { ServiceDefinition } from "../../aws/types";

import compute from "./compute";
import networking from "./networking";
import storage from "./storage";
import database from "./database";
import integration from "./integration";
import analytics from "./analytics";
import security from "./security";

const GCP_SERVICES: ServiceDefinition[] = [
  ...compute,
  ...networking,
  ...storage,
  ...database,
  ...integration,
  ...analytics,
  ...security,
];

export default GCP_SERVICES;
