import { describe, it, expect } from "vitest";
import { validateGraph, emptyGraph, type ResourceInstance } from "./model";
import { getService, serviceProvider } from "./registry";

/**
 * Proves the core promise: a SINGLE diagram can mix providers. Real-world
 * deployments span clouds, so one InfrastructureGraph must be able to hold AWS,
 * GCP and Azure resources side by side and stay valid/renderable.
 */
describe("multi-cloud diagrams", () => {
  it("a single graph can hold AWS + GCP + Azure resources and validates clean", () => {
    const mk = (id: string, serviceId: string): ResourceInstance => ({
      id,
      serviceId,
      name: serviceId,
      source: "manual",
      config: {},
    });

    const graph = emptyGraph("Multi-cloud app");
    graph.resources = [
      mk("a", "ec2-instance"), // AWS
      mk("g", "gcp-cloud-storage"), // GCP
      mk("z", "azure-vm"), // Azure
    ];
    // A cross-cloud edge (e.g. an AWS service reading from a GCP bucket).
    graph.relationships = [{ id: "e1", from: "a", to: "g", kind: "reads_from" }];

    // Every resource resolves to a real, renderable service in the registry.
    const providers = graph.resources.map((r) => serviceProvider(getService(r.serviceId)!));
    expect(providers.sort()).toEqual(["aws", "azure", "gcp"]);

    // The graph is structurally valid — the canvas can render it as one diagram.
    expect(validateGraph(graph)).toEqual([]);
  });
});
