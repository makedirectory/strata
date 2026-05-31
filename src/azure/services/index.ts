/**
 * Microsoft Azure service catalog — aggregator.
 * ---------------------------------------------
 * Mirrors the AWS catalog layout (`src/aws/services/*.ts`): each category file
 * default-exports a `ServiceDefinition[]` with `provider: "azure"` and an ARM
 * `nativeType` (e.g. "Microsoft.Compute/virtualMachines"). The registry
 * flattens this list alongside AWS and GCP.
 *
 * `management.ts` carries the **Resource Group** container — Azure's mandatory
 * regional grouping for resources, with no AWS/GCP analog.
 */
import type { ServiceDefinition } from "../../aws/types";

import management from "./management";
import compute from "./compute";
import networking from "./networking";
import storage from "./storage";
import database from "./database";
import integration from "./integration";
import analytics from "./analytics";
import security from "./security";

const AZURE_SERVICES: ServiceDefinition[] = [
  ...management,
  ...compute,
  ...networking,
  ...storage,
  ...database,
  ...integration,
  ...analytics,
  ...security,
];

export default AZURE_SERVICES;
