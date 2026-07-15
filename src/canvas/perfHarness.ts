/**
 * Synthetic graph generator for the dev perf harness (`/perf`).
 *
 * Builds a realistic, deeply-nested estate of ~N resources (accounts ▸ VPCs ▸
 * subnets ▸ leaves) with a scattering of relationships, using real service ids so
 * the WebGL layer exercises the same colour/icon/pill/containment paths as a real
 * diagram. Pure and deterministic (seeded), so a run at a given N is repeatable.
 * Roots are left position-less so `computeLayout` grids them.
 */
import type { InfrastructureGraph, ResourceInstance, Relationship } from "../aws/model";
import { emptyGraph } from "../aws/model";

const LEAF_SERVICES = [
  "ec2-instance",
  "rds",
  "s3-bucket",
  "lambda",
  "dynamodb",
  "elasticache",
  "sqs",
  "sns",
  "cloudwatch",
  "api-gateway",
];

/** Generate a synthetic graph of exactly `n` resources (min 1). */
export function generateSyntheticGraph(n: number): InfrastructureGraph {
  const total = Math.max(1, Math.floor(n));
  const g = emptyGraph(`perf-${total}`);
  const resources: ResourceInstance[] = [];
  const relationships: Relationship[] = [];
  let seed = 0x2f6e2b1;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const push = (id: string, serviceId: string, parentId?: string) => {
    const r: ResourceInstance = { id, serviceId, name: id, config: {}, source: "manual" };
    if (parentId) r.parentId = parentId;
    resources.push(r);
  };

  let acct = 0;
  while (resources.length < total) {
    const a = `acct-${acct}`;
    push(a, "organizations"); // root (position-less → gridded)
    for (let v = 0; v < 2 && resources.length < total; v++) {
      const vpc = `${a}-vpc-${v}`;
      push(vpc, "vpc", a);
      for (let s = 0; s < 3 && resources.length < total; s++) {
        const sn = `${vpc}-sn-${s}`;
        push(sn, s % 2 ? "subnet-private" : "subnet-public", vpc);
        let prev: string | null = null;
        for (let l = 0; l < 8 && resources.length < total; l++) {
          const id = `${sn}-r-${l}`;
          push(id, LEAF_SERVICES[Math.floor(rnd() * LEAF_SERVICES.length)], sn);
          if (prev && rnd() < 0.4) {
            relationships.push({
              id: `e-${relationships.length}`,
              from: prev,
              to: id,
              kind: "depends_on",
              source: "manual",
            });
          }
          prev = id;
        }
      }
    }
    acct++;
  }

  g.resources = resources;
  g.relationships = relationships;
  return g;
}
