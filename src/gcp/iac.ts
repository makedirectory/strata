/**
 * Google Cloud — Infrastructure-as-Code import/export (Terraform `google`).
 * ------------------------------------------------------------------------
 * GCP's realistic declarative IaC is the Terraform google provider (Deployment
 * Manager is deprecated; Config Connector/KRM is a possible follow-up). This
 * adapter mirrors the AWS Terraform path: it maps `google_*` HCL types to
 * registry serviceIds and reuses the shared `importTerraform`/`exportTerraform`
 * engine — the multi-cloud invariant is "one builder, one resolver".
 */
import type { IacImportResult } from "../aws/iac";
import { importTerraform } from "../aws/iac";
import type { TerraformExport } from "../aws/iacExport";
import { exportTerraform } from "../aws/iacExport";
import type { InfrastructureGraph } from "../aws/model";

/** Terraform `google_*` resource type → registry serviceId (GCP catalog). */
export const GCP_TF_TYPE_TO_SERVICE_ID: Record<string, string> = {
  google_compute_instance: "gcp-compute-engine",
  google_compute_instance_group_manager: "gcp-instance-group-manager",
  google_compute_region_instance_group_manager: "gcp-instance-group-manager",
  google_container_cluster: "gcp-gke-cluster",
  google_cloud_run_service: "gcp-cloud-run",
  google_cloud_run_v2_service: "gcp-cloud-run",
  google_cloudfunctions_function: "gcp-cloud-functions",
  google_cloudfunctions2_function: "gcp-cloud-functions",
  google_app_engine_application: "gcp-app-engine",
  google_pubsub_topic: "gcp-pubsub-topic",
  google_pubsub_subscription: "gcp-pubsub-subscription",
  google_cloud_tasks_queue: "gcp-cloud-tasks",
  google_workflows_workflow: "gcp-workflows",
  google_eventarc_trigger: "gcp-eventarc",
  google_storage_bucket: "gcp-cloud-storage",
  google_compute_disk: "gcp-persistent-disk",
  google_filestore_instance: "gcp-filestore",
  google_service_account: "gcp-service-account",
  google_secret_manager_secret: "gcp-secret-manager",
  google_kms_key_ring: "gcp-cloud-kms-keyring",
  google_kms_crypto_key: "gcp-cloud-kms-cryptokey",
  google_compute_network: "gcp-vpc-network",
  google_compute_subnetwork: "gcp-subnet",
  google_compute_firewall: "gcp-firewall-rule",
  google_compute_backend_service: "gcp-backend-service",
  google_dns_managed_zone: "gcp-cloud-dns",
  google_compute_router: "gcp-cloud-router",
  google_compute_router_nat: "gcp-cloud-nat",
  google_compute_url_map: "gcp-cloud-cdn",
  google_sql_database_instance: "gcp-cloud-sql",
  google_spanner_instance: "gcp-spanner",
  google_bigtable_instance: "gcp-bigtable",
  google_firestore_database: "gcp-firestore",
  google_redis_instance: "gcp-memorystore",
  google_bigquery_dataset: "gcp-bigquery-dataset",
  google_bigquery_table: "gcp-bigquery-table",
  google_dataflow_job: "gcp-dataflow",
  google_dataproc_cluster: "gcp-dataproc",
  google_vertex_ai_endpoint: "gcp-vertex-ai-endpoint",
};

/** GCP containment references in Terraform (subnetwork/network). */
const GCP_CONTAINMENT_KEYS = ["subnetwork", "network"];

/**
 * serviceId → canonical Terraform type. The import table is many-to-one (e.g.
 * google_cloud_run_service / _v2_service), so the inverse keeps the FIRST-listed
 * Terraform type as the canonical export target.
 */
export const GCP_SERVICE_ID_TO_TF_TYPE: Record<string, string> = (() => {
  const inv: Record<string, string> = {};
  for (const [tfType, serviceId] of Object.entries(GCP_TF_TYPE_TO_SERVICE_ID)) {
    if (!(serviceId in inv)) inv[serviceId] = tfType;
  }
  return inv;
})();

/** Import a Terraform (`google` provider) document into a GCP graph. */
export function importGcpTerraform(tf: unknown, name = "GCP Terraform Import"): IacImportResult {
  return importTerraform(tf, name, {
    typeMap: GCP_TF_TYPE_TO_SERVICE_ID,
    containmentKeys: GCP_CONTAINMENT_KEYS,
  });
}

/** Export a graph's GCP resources as Terraform (`google` provider) HCL. */
export function exportGcpTerraform(graph: InfrastructureGraph): TerraformExport {
  return exportTerraform(graph, GCP_SERVICE_ID_TO_TF_TYPE);
}
