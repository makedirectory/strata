import { describe, it, expect } from "vitest";
import {
  importGcpTerraform,
  exportGcpTerraform,
  GCP_TF_TYPE_TO_SERVICE_ID,
  GCP_SERVICE_ID_TO_TF_TYPE,
} from "./iac";
import { getService } from "../aws/registry";

const tfState = {
  format_version: "1.0",
  values: {
    root_module: {
      resources: [
        {
          address: "google_compute_network.vpc",
          type: "google_compute_network",
          name: "vpc",
          values: { id: "net-1", name: "main-vpc" },
        },
        {
          address: "google_compute_subnetwork.sub",
          type: "google_compute_subnetwork",
          name: "sub",
          values: { id: "sub-1", network: "net-1", ip_cidr_range: "10.0.0.0/24" },
        },
        {
          address: "google_storage_bucket.assets",
          type: "google_storage_bucket",
          name: "assets",
          values: { id: "assets-bkt", name: "assets-bkt" },
        },
      ],
    },
  },
};

describe("GCP Terraform import", () => {
  it("maps google_* types to GCP services and tags them provider gcp", () => {
    const { graph, unmappedTypes } = importGcpTerraform(tfState);
    expect(unmappedTypes).toEqual([]);
    expect(graph.resources).toHaveLength(3);
    const ids = graph.resources.map((r) => r.serviceId).sort();
    expect(ids).toEqual(["gcp-cloud-storage", "gcp-subnet", "gcp-vpc-network"]);
    // Every resolved service is a GCP-provider service.
    for (const r of graph.resources) {
      expect(getService(r.serviceId)?.provider).toBe("gcp");
    }
  });

  it("infers subnet→network containment from the network reference", () => {
    const { graph } = importGcpTerraform(tfState);
    const subnet = graph.resources.find((r) => r.serviceId === "gcp-subnet");
    const vpc = graph.resources.find((r) => r.serviceId === "gcp-vpc-network");
    expect(subnet?.parentId).toBe(vpc?.id);
  });

  it("resolves containment when the reference is a self_link (real GCP state)", () => {
    const selfLinkState = {
      values: {
        root_module: {
          resources: [
            {
              address: "google_compute_network.vpc",
              type: "google_compute_network",
              name: "vpc",
              values: {
                id: "projects/p/global/networks/main",
                name: "main",
                self_link: "https://www.googleapis.com/compute/v1/projects/p/global/networks/main",
              },
            },
            {
              address: "google_compute_subnetwork.sub",
              type: "google_compute_subnetwork",
              name: "sub",
              values: {
                id: "sub-1",
                // Subnet points at the network by its self_link, not bare id.
                network: "https://www.googleapis.com/compute/v1/projects/p/global/networks/main",
              },
            },
          ],
        },
      },
    };
    const { graph } = importGcpTerraform(selfLinkState);
    const subnet = graph.resources.find((r) => r.serviceId === "gcp-subnet");
    const vpc = graph.resources.find((r) => r.serviceId === "gcp-vpc-network");
    expect(subnet?.parentId).toBe(vpc?.id);
  });
});

describe("GCP Terraform export", () => {
  it("emits google_* blocks for a GCP graph", () => {
    const { graph } = importGcpTerraform(tfState);
    const { hcl, report } = exportGcpTerraform(graph);
    expect(report.exported).toBeGreaterThan(0);
    expect(hcl).toContain('resource "google_compute_network"');
    expect(hcl).toContain('resource "google_storage_bucket"');
  });
});

describe("GCP type map", () => {
  it("only references service ids that exist in the registry", () => {
    for (const serviceId of Object.values(GCP_TF_TYPE_TO_SERVICE_ID)) {
      expect(getService(serviceId), `missing service ${serviceId}`).toBeDefined();
    }
  });

  it("inverse export prefers current GCP types", () => {
    // Many-to-one import collapses to current (non-deprecated) export targets.
    expect(GCP_SERVICE_ID_TO_TF_TYPE["gcp-cloud-run"]).toBe("google_cloud_run_v2_service");
    expect(GCP_SERVICE_ID_TO_TF_TYPE["gcp-cloud-functions"]).toBe(
      "google_cloudfunctions2_function",
    );
  });

  it("maps google_container_node_pool", () => {
    expect(GCP_TF_TYPE_TO_SERVICE_ID["google_container_node_pool"]).toBe("gcp-gke-cluster");
  });
});

describe("GCP Terraform planned_values import", () => {
  it("imports a GCP terraform planned_values shape", () => {
    const { graph, unmappedTypes } = importGcpTerraform({
      planned_values: {
        root_module: {
          resources: [
            {
              address: "google_storage_bucket.b",
              type: "google_storage_bucket",
              name: "b",
              values: { id: "b" },
            },
          ],
        },
      },
    });
    expect(unmappedTypes).toEqual([]);
    expect(graph.resources).toHaveLength(1);
    expect(graph.resources[0].serviceId).toBe("gcp-cloud-storage");
  });
});
