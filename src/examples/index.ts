/**
 * Bundled example architectures shown in the Start hub.
 *
 * These are the same native `InfrastructureGraph` fixtures that live under
 * `mock-data/` (the single source of truth, validated by
 * `src/lib/mockFixtures.test.ts`); we import them directly so there is no
 * duplication or drift. Loading one replaces the canvas via `loadExample`.
 */
import type { InfrastructureGraph } from "../aws/model";
import microservices from "../../mock-data/aws-microservices-platform.json";
import serverless from "../../mock-data/aws-serverless-data-pipeline.json";
import multicloudEnterprise from "../../mock-data/multicloud-enterprise.json";
import threeTier from "../../mock-data/aws-three-tier.json";
import multicloudShowcase from "../../mock-data/multicloud-showcase.json";

export interface Example {
  /** Stable id (also the mock-data filename stem). */
  id: string;
  /** Short label for the gallery card. */
  label: string;
  /** Emoji shown on the card. */
  icon: string;
  graph: InfrastructureGraph;
}

/** Curated, ordered list (smallest → largest) for the Start-hub gallery. */
export const EXAMPLES: Example[] = [
  {
    id: "aws-three-tier",
    label: "AWS Three-Tier Web App",
    icon: "🌐",
    graph: threeTier as unknown as InfrastructureGraph,
  },
  {
    id: "multicloud-showcase",
    label: "Multi-Cloud Showcase",
    icon: "🎛️",
    graph: multicloudShowcase as unknown as InfrastructureGraph,
  },
  {
    id: "aws-serverless-data-pipeline",
    label: "Serverless Data Pipeline",
    icon: "⚡",
    graph: serverless as unknown as InfrastructureGraph,
  },
  {
    id: "multicloud-enterprise",
    label: "Multi-Cloud Enterprise",
    icon: "🏢",
    graph: multicloudEnterprise as unknown as InfrastructureGraph,
  },
  {
    id: "aws-microservices-platform",
    label: "AWS Microservices Platform",
    icon: "🧱",
    graph: microservices as unknown as InfrastructureGraph,
  },
];

export function getExample(id: string): Example | undefined {
  return EXAMPLES.find((e) => e.id === id);
}
