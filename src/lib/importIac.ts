/**
 * Unified multi-cloud IaC import.
 * -------------------------------
 * One entry point for the "Import IaC" dialog that auto-detects and routes:
 *   - **ARM templates** (JSON, `resources[]` array)        → Azure `importArm`
 *   - **CloudFormation** (JSON/YAML, `Resources` map)       → `importCloudFormation`
 *   - **Terraform** (`show -json` state / plan)             → `importTerraform`
 *     with a MERGED type map (aws_* + google_* + azurerm_*), so a state file
 *     from any provider — or a mixed one — resolves through the shared builder.
 *
 * Lives in `lib/` (not `aws/iac.ts`) to avoid a circular import: the GCP/Azure
 * adapters import the shared engine from `aws/iac`, so the engine can't import
 * them back.
 */
import {
  importIaC,
  importCloudFormation,
  importTerraform,
  detectFormat,
  TF_TYPE_TO_SERVICE_ID,
  type IacImportResult,
} from "../aws/iac";
import { GCP_TF_TYPE_TO_SERVICE_ID } from "../gcp/iac";
import { AZURE_TF_TYPE_TO_SERVICE_ID, importArm, isArmTemplate } from "../azure/iac";

/**
 * Terraform type → serviceId across all providers. The `aws_*` / `google_*` /
 * `azurerm_*` prefixes are disjoint, so merging never collides.
 */
export const MERGED_TF_TYPE_TO_SERVICE_ID: Record<string, string> = {
  ...TF_TYPE_TO_SERVICE_ID,
  ...GCP_TF_TYPE_TO_SERVICE_ID,
  ...AZURE_TF_TYPE_TO_SERVICE_ID,
};

/** Union of every provider's Terraform containment-reference keys. */
export const MERGED_CONTAINMENT_KEYS = [
  "subnet_id",
  "vpc_id", // AWS
  "subnetwork",
  "network", // GCP
  "virtual_network_id", // Azure
];

/**
 * Import an IaC document of any supported format/provider from raw text.
 * Mirrors `importIaC`'s signature so it's a drop-in replacement, but also
 * recognises Azure ARM templates and resolves GCP/Azure Terraform types.
 */
export function importAnyIaC(content: string, opts: { name?: string } = {}): IacImportResult {
  const trimmed = content.trim();
  const looksJson = trimmed.startsWith("{") || trimmed.startsWith("[");

  if (looksJson) {
    let doc: unknown;
    try {
      doc = JSON.parse(trimmed);
    } catch {
      throw new Error("Not valid JSON.");
    }
    // ARM first: it has a `resources` array (not CloudFormation's `Resources`
    // map), so `detectFormat` would otherwise reject it.
    if (isArmTemplate(doc)) return importArm(doc, opts.name ?? "ARM Import");
    const format = detectFormat(doc); // throws if neither CFN nor Terraform
    if (format === "cloudformation") {
      return importCloudFormation(doc, opts.name ?? "CloudFormation Import");
    }
    return importTerraform(doc, opts.name ?? "Terraform Import", {
      typeMap: MERGED_TF_TYPE_TO_SERVICE_ID,
      containmentKeys: MERGED_CONTAINMENT_KEYS,
    });
  }

  // Non-JSON ⇒ YAML, which only CloudFormation uses; defer to the AWS parser
  // (it handles CFN short-form intrinsic tags).
  return importIaC(content, opts);
}
