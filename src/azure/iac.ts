/**
 * Microsoft Azure — Infrastructure-as-Code import/export.
 * -------------------------------------------------------
 * Two paths, both reusing the shared engine in `src/aws/{iac,iacExport}.ts`:
 *
 *  - **ARM templates (JSON)** — the marquee path. Structurally a near-twin of
 *    CloudFormation: a typed `resources[]` array whose `type` (the ARM resource
 *    type, e.g. "Microsoft.Compute/virtualMachines") IS the registry join key
 *    via `getServiceByNativeType("azure", type)`. Import captures a verbatim
 *    `raw` sidecar (format "arm") and template sections (parameters/outputs) so
 *    export can re-emit a faithful template.
 *  - **Terraform azurerm** — mirrors the AWS/GCP Terraform path via a type map.
 *
 * Bicep is intentionally out of scope (compile-to-ARM only, owner-gated).
 */
import type { IacImportResult, ResolvedItem, TerraformImportOptions } from "../aws/iac";
import { importTerraform, buildGraph, isRecord } from "../aws/iac";
import type { ExportReport, TerraformExport } from "../aws/iacExport";
import { exportTerraform } from "../aws/iacExport";
import type { InfrastructureGraph, RawSource, IacSource, ResourceInstance } from "../aws/model";
import type { RelationshipKind } from "../aws/types";
import { getService, getServiceByNativeType } from "../aws/registry";

// ---------------------------------------------------------------------------
// ARM templates
// ---------------------------------------------------------------------------

const ARM_SCHEMA_DEFAULT =
  "https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#";

interface ArmResource {
  type: string;
  apiVersion?: string;
  name: string;
  properties?: Record<string, unknown>;
  dependsOn?: string[];
  resources?: ArmResource[];
}

/** True when a parsed document looks like an ARM deployment template. */
export function isArmTemplate(doc: unknown): boolean {
  if (!isRecord(doc)) return false;
  const schema = typeof doc.$schema === "string" ? doc.$schema : "";
  return (
    (schema.includes("deploymentTemplate.json") || "contentVersion" in doc) &&
    Array.isArray(doc.resources)
  );
}

/** Extract the target resource name from an ARM `resourceId(...)` expression. */
function armDependsOnTarget(expr: unknown): string | undefined {
  if (typeof expr !== "string") return undefined;
  // e.g. "[resourceId('Microsoft.Sql/servers', 'myserver')]" → "myserver".
  const quoted = expr.match(/'([^']*)'/g);
  if (quoted && quoted.length > 0) {
    const last = quoted[quoted.length - 1];
    return last.slice(1, -1);
  }
  // Plain name fallback.
  return expr.includes("[") ? undefined : expr;
}

/**
 * Flatten an ARM resource tree to (resource, parentName) pairs. ARM nests in two
 * ways: an inline `resources` array (the parent name is the container) and the
 * "parent/child" naming convention on child types.
 */
function flattenArm(
  resources: ArmResource[],
  parentName: string | undefined,
  out: { res: ArmResource; parentName?: string }[],
): void {
  for (const res of resources) {
    if (!isRecord(res) || typeof res.type !== "string" || typeof res.name !== "string") continue;
    // "parent/child" name → parent is the first segment.
    const slashParent = res.name.includes("/") ? res.name.split("/")[0] : undefined;
    out.push({ res, parentName: parentName ?? slashParent });
    if (Array.isArray(res.resources)) flattenArm(res.resources, res.name, out);
  }
}

/** Import an ARM deployment template (JSON) into an Azure graph. */
export function importArm(template: unknown, name = "ARM Import"): IacImportResult {
  const warnings: string[] = [];
  if (!isRecord(template) || !Array.isArray(template.resources)) {
    throw new Error("Not an ARM template: missing top-level 'resources' array.");
  }

  const flat: { res: ArmResource; parentName?: string }[] = [];
  flattenArm(template.resources as ArmResource[], undefined, flat);

  const names = new Set(flat.map((f) => f.res.name));
  const items: ResolvedItem[] = [];
  const unmapped = new Set<string>();

  for (const { res, parentName } of flat) {
    const svc = getServiceByNativeType("azure", res.type);
    if (!svc) {
      unmapped.add(res.type);
      continue;
    }
    const props = isRecord(res.properties) ? res.properties : {};

    // Relationships from dependsOn (resourceId expressions resolved to names).
    const rels: { to: string; kind: RelationshipKind }[] = [];
    const parent =
      parentName && names.has(parentName) && parentName !== res.name ? parentName : undefined;
    for (const dep of res.dependsOn ?? []) {
      const target = armDependsOnTarget(dep);
      if (target && names.has(target) && target !== res.name && target !== parent) {
        rels.push({ to: target, kind: "depends_on" });
      }
    }

    const raw: RawSource = { format: "arm", type: res.type, properties: props };
    if (typeof res.apiVersion === "string") raw.apiVersion = res.apiVersion;
    if (Array.isArray(res.dependsOn)) {
      raw.dependsOn = res.dependsOn.filter((d): d is string => typeof d === "string");
    }

    items.push({
      id: res.name,
      serviceId: svc.id,
      name: res.name.includes("/") ? res.name.split("/").slice(-1)[0] : res.name,
      parentId: parent,
      properties: props,
      relationships: rels,
      raw,
    });
  }

  if (items.length === 0)
    warnings.push("No resources matched the service registry — nothing to render.");
  if (unmapped.size > 0) {
    warnings.push(
      `${unmapped.size} ARM resource type(s) are not yet in the registry and were skipped.`,
    );
  }

  return {
    graph: buildGraph(items, name, captureArmSections(template)),
    format: "cloudformation", // shared IacImportResult format union; ARM rides the CFN-like path
    unmappedTypes: [...unmapped],
    warnings,
  };
}

/** Capture ARM template-level sections (parameters/variables/outputs/…). */
function captureArmSections(template: Record<string, unknown>): IacSource | undefined {
  const src: IacSource = { format: "arm" };
  let any = false;
  if (typeof template.$schema === "string") {
    src.armSchema = template.$schema;
    any = true;
  }
  if (typeof template.contentVersion === "string") {
    src.contentVersion = template.contentVersion;
    any = true;
  }
  for (const [from, to] of [
    ["parameters", "parameters"],
    ["variables", "mappings"],
    ["outputs", "outputs"],
    ["metadata", "metadata"],
  ] as const) {
    if (isRecord(template[from])) {
      src[to] = template[from] as Record<string, unknown>;
      any = true;
    }
  }
  return any ? src : undefined;
}

const ARM_HEADER_NOTE =
  "Generated by Strata. Scaffold, not deploy-ready: property names follow " +
  "Strata's model and TODO markers flag fields you must complete.";

export interface ArmExport {
  json: string;
  report: ExportReport;
}

/** Export a graph's Azure resources as an ARM deployment template (JSON). */
export function exportArm(graph: InfrastructureGraph): ArmExport {
  const report: ExportReport = { exported: 0, faithful: 0, skipped: [], todos: [], warnings: [] };
  const sorted = [...graph.resources].sort((a, b) => a.id.localeCompare(b.id));
  const armResources: Record<string, unknown>[] = [];

  for (const resource of sorted) {
    const svc = getService(resource.serviceId);
    const faithfulRaw = resource.raw?.format === "arm" ? resource.raw : undefined;
    const armType = faithfulRaw?.type ?? svc?.nativeType;
    if (!armType) {
      report.skipped.push({
        id: resource.id,
        serviceId: resource.serviceId,
        reason: "no ARM type in the registry",
      });
      continue;
    }
    if (faithfulRaw) {
      const entry: Record<string, unknown> = {
        type: faithfulRaw.type,
        apiVersion: faithfulRaw.apiVersion ?? "2021-04-01",
        name: resource.name,
      };
      if (faithfulRaw.properties && Object.keys(faithfulRaw.properties).length > 0) {
        entry.properties = faithfulRaw.properties;
      }
      if (faithfulRaw.dependsOn?.length) entry.dependsOn = faithfulRaw.dependsOn;
      armResources.push(entry);
      report.faithful++;
    } else {
      const { properties, todoKeys } = scaffoldArmProperties(resource, svc);
      const entry: Record<string, unknown> = {
        type: armType,
        apiVersion: "2021-04-01",
        name: resource.name,
      };
      if (Object.keys(properties).length > 0) entry.properties = properties;
      for (const key of todoKeys) report.todos.push({ address: resource.name, field: key });
      armResources.push(entry);
    }
    report.exported++;
  }

  if (report.exported === 0) report.warnings.push("No resources could be exported to ARM.");
  if (report.skipped.length > 0) {
    report.warnings.push(`${report.skipped.length} resource(s) skipped (no ARM type).`);
  }

  const src = graph.iacSource?.format === "arm" ? graph.iacSource : undefined;
  const template: Record<string, unknown> = {
    $schema: src?.armSchema ?? ARM_SCHEMA_DEFAULT,
    contentVersion: src?.contentVersion ?? "1.0.0.0",
    metadata: { _generator: ARM_HEADER_NOTE },
  };
  if (src?.parameters) template.parameters = src.parameters;
  if (src?.mappings) template.variables = src.mappings;
  template.resources = armResources;
  if (src?.outputs) template.outputs = src.outputs;

  return { json: JSON.stringify(template, null, 2), report };
}

/** Scaffold ARM `properties` from the registry-known config + required TODOs. */
function scaffoldArmProperties(
  resource: ResourceInstance,
  svc: ReturnType<typeof getService>,
): { properties: Record<string, unknown>; todoKeys: string[] } {
  const properties: Record<string, unknown> = {};
  const todoKeys: string[] = [];
  if (!svc) return { properties, todoKeys };
  for (const field of svc.configFields) {
    const has = Object.prototype.hasOwnProperty.call(resource.config, field.key);
    const val = resource.config[field.key];
    const name = svc.cfnPropertyNames?.[field.key] ?? field.key;
    if (has && val !== "" && val !== undefined) {
      properties[name] = val;
    } else if (field.required) {
      properties[name] = "TODO: required — set this value";
      todoKeys.push(field.key);
    }
  }
  return { properties, todoKeys };
}

// ---------------------------------------------------------------------------
// Terraform azurerm
// ---------------------------------------------------------------------------

/** Terraform `azurerm_*` resource type → registry serviceId (Azure catalog). */
export const AZURE_TF_TYPE_TO_SERVICE_ID: Record<string, string> = {
  azurerm_virtual_machine: "azure-vm",
  azurerm_linux_virtual_machine: "azure-vm",
  azurerm_windows_virtual_machine: "azure-vm",
  azurerm_virtual_machine_scale_set: "azure-vmss",
  azurerm_linux_virtual_machine_scale_set: "azure-vmss",
  azurerm_windows_virtual_machine_scale_set: "azure-vmss",
  azurerm_kubernetes_cluster: "azure-aks",
  azurerm_app_service: "azure-app-service",
  azurerm_linux_web_app: "azure-app-service",
  azurerm_windows_web_app: "azure-app-service",
  azurerm_function_app: "azure-functions",
  azurerm_linux_function_app: "azure-functions",
  azurerm_container_group: "azure-container-instances",
  azurerm_resource_group: "azure-resource-group",
  azurerm_virtual_network: "azure-vnet",
  azurerm_subnet: "azure-subnet",
  azurerm_network_security_group: "azure-nsg",
  azurerm_lb: "azure-load-balancer",
  azurerm_application_gateway: "azure-app-gateway",
  azurerm_public_ip: "azure-public-ip",
  azurerm_route_table: "azure-route-table",
  azurerm_dns_zone: "azure-dns-zone",
  azurerm_servicebus_namespace: "azure-service-bus",
  azurerm_eventhub_namespace: "azure-event-hub",
  azurerm_eventgrid_topic: "azure-event-grid",
  azurerm_logic_app_workflow: "azure-logic-app",
  azurerm_storage_queue: "azure-storage-queue",
  azurerm_storage_account: "azure-storage-account",
  azurerm_storage_container: "azure-blob-container",
  azurerm_managed_disk: "azure-managed-disk",
  azurerm_mssql_server: "azure-sql-server",
  azurerm_sql_server: "azure-sql-server",
  azurerm_mssql_database: "azure-sql-database",
  azurerm_sql_database: "azure-sql-database",
  azurerm_cosmosdb_account: "azure-cosmos-db",
  azurerm_postgresql_flexible_server: "azure-postgresql",
  azurerm_redis_cache: "azure-redis",
  azurerm_synapse_workspace: "azure-synapse",
  azurerm_data_factory: "azure-data-factory",
  azurerm_databricks_workspace: "azure-databricks",
  azurerm_stream_analytics_job: "azure-stream-analytics",
  azurerm_machine_learning_workspace: "azure-ml-workspace",
  azurerm_key_vault: "azure-key-vault",
  azurerm_user_assigned_identity: "azure-managed-identity",
  azurerm_cognitive_account: "azure-cognitive-services",
};

const AZURE_CONTAINMENT_KEYS = ["subnet_id", "virtual_network_id"];

export const AZURE_SERVICE_ID_TO_TF_TYPE: Record<string, string> = (() => {
  const inv: Record<string, string> = {};
  for (const [tfType, serviceId] of Object.entries(AZURE_TF_TYPE_TO_SERVICE_ID)) {
    if (!(serviceId in inv)) inv[serviceId] = tfType;
  }
  return inv;
})();

/** Import a Terraform (`azurerm` provider) document into an Azure graph. */
export function importAzureTerraform(
  tf: unknown,
  name = "Azure Terraform Import",
): IacImportResult {
  const opts: TerraformImportOptions = {
    typeMap: AZURE_TF_TYPE_TO_SERVICE_ID,
    containmentKeys: AZURE_CONTAINMENT_KEYS,
  };
  return importTerraform(tf, name, opts);
}

/** Export a graph's Azure resources as Terraform (`azurerm` provider) HCL. */
export function exportAzureTerraform(graph: InfrastructureGraph): TerraformExport {
  return exportTerraform(graph, AZURE_SERVICE_ID_TO_TF_TYPE);
}
