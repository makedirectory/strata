/**
 * Rough monthly cost estimation — pure, heuristic, intentionally approximate.
 *
 * This is a back-of-the-envelope figure to give a sense of relative spend on the
 * canvas, NOT a billing forecast: it ignores data transfer, request volume,
 * commitment discounts, region differences and most usage dimensions. Estimates
 * are keyed by registry `serviceId` with light config-based refinement for the
 * big-ticket compute/database services. Unknown services return `null` (shown as
 * "—"); free/structural services (VPC, subnet, IGW, SG…) return 0.
 */
import type { ResourceInstance } from "./model";

/** Flat monthly USD by serviceId (≈730 hrs where hourly). 0 = free/structural. */
const BASE_MONTHLY: Record<string, number> = {
  // networking — mostly free, NAT is the notable exception
  vpc: 0,
  "subnet-public": 0,
  "subnet-private": 0,
  "internet-gateway": 0,
  "route-table": 0,
  nacl: 0,
  "security-group": 0,
  "vpc-peering": 0,
  "nat-gateway": 32,
  "elastic-load-balancer": 18,
  "target-group": 0,
  route53: 1,
  "route53-record": 0,
  cloudfront: 10,
  "global-accelerator": 18,
  // compute
  "ec2-instance": 50,
  lambda: 5,
  "auto-scaling-group": 100,
  "ecs-service": 30,
  fargate: 30,
  "eks-cluster": 73,
  batch: 40,
  lightsail: 10,
  // storage
  "s3-bucket": 5,
  "ebs-volume": 10,
  efs: 30,
  fsx: 120,
  "s3-glacier": 2,
  // database
  rds: 60,
  aurora: 200,
  dynamodb: 5,
  elasticache: 50,
  documentdb: 200,
  neptune: 200,
  redshift: 180,
  memorydb: 90,
  // integration / app
  "api-gateway": 5,
  sqs: 1,
  sns: 1,
  eventbridge: 1,
  "step-functions": 2,
  "kinesis-data-streams": 30,
  "kinesis-firehose": 20,
  "amazon-mq": 30,
  appsync: 5,
  // security / mgmt
  kms: 1,
  "secrets-manager": 1,
  waf: 8,
  guardduty: 10,
  cognito: 5,
  // analytics
  opensearch: 100,
  athena: 5,
  glue: 20,
  emr: 150,
  // observability
  cloudwatch: 3,
  "cloudwatch-logs": 5,
  // ---- GCP ----
  "gcp-compute-engine": 40,
  "gcp-cloud-run": 10,
  "gcp-cloud-functions": 5,
  "gcp-gke-cluster": 73,
  "gcp-cloud-sql": 50,
  "gcp-cloud-storage": 5,
  "gcp-vpc-network": 0,
  "gcp-subnet": 0,
  "gcp-firewall-rule": 0,
  "gcp-cloud-nat": 32,
  "gcp-pubsub-topic": 1,
  "gcp-bigquery-dataset": 20,
  "gcp-memorystore": 50,
  "gcp-spanner": 90,
  // ---- Azure ----
  "azure-vm": 50,
  "azure-aks": 73,
  "azure-app-service": 55,
  "azure-functions": 5,
  "azure-sql-database": 30,
  "azure-cosmos-db": 24,
  "azure-storage-account": 5,
  "azure-vnet": 0,
  "azure-subnet": 0,
  "azure-nsg": 0,
  "azure-load-balancer": 18,
  "azure-redis": 50,
  "azure-service-bus": 10,
};

// Per-unit monthly USD (≈730 hrs, us-east-1 baseline) for sized/tiered services.
const EC2_BY_TYPE: Record<string, number> = {
  "t3.micro": 8,
  "t3.small": 15,
  "t3.medium": 30,
  "t3.large": 60,
  "t3.xlarge": 120,
  "t3.2xlarge": 240,
  "m5.large": 70,
  "m5.xlarge": 140,
  "m5.2xlarge": 280,
  "m5.4xlarge": 560,
  "c5.large": 62,
  "c5.xlarge": 124,
  "c5.2xlarge": 248,
  "r5.large": 92,
  "r5.xlarge": 184,
};
const RDS_BY_CLASS: Record<string, number> = {
  "db.t3.micro": 15,
  "db.t3.small": 30,
  "db.t3.medium": 60,
  "db.t3.large": 120,
  "db.m5.large": 125,
  "db.m5.xlarge": 250,
  "db.m5.2xlarge": 500,
  "db.r5.large": 175,
  "db.r5.xlarge": 350,
};
const CACHE_BY_TYPE: Record<string, number> = {
  "cache.t3.micro": 12,
  "cache.t3.small": 24,
  "cache.t3.medium": 50,
  "cache.m5.large": 125,
  "cache.m6g.large": 110,
  "cache.r6g.large": 160,
};
const GCP_VM_BY_TYPE: Record<string, number> = {
  "e2-micro": 6,
  "e2-small": 13,
  "e2-medium": 25,
  "n1-standard-1": 25,
  "n2-standard-2": 70,
  "n2-standard-4": 140,
};
const AZURE_VM_BY_SIZE: Record<string, number> = {
  Standard_B1s: 8,
  Standard_B2s: 30,
  Standard_D2s_v3: 70,
  Standard_D4s_v3: 140,
  Standard_D8s_v3: 280,
};
/** EBS $/GiB-month by volume type (gp3 default). */
const EBS_GB_BY_TYPE: Record<string, number> = {
  gp3: 0.08,
  gp2: 0.1,
  io1: 0.125,
  io2: 0.125,
  st1: 0.045,
  sc1: 0.015,
};
const RDS_STORAGE_GB = 0.115; // gp-SSD $/GiB-month

const str = (r: ResourceInstance, k: string): string | undefined =>
  typeof r.config[k] === "string" ? (r.config[k] as string) : undefined;

/** Read a numeric config value (number or numeric string), else `def`. */
const num = (r: ResourceInstance, k: string, def: number): number => {
  const v = r.config[k];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return def;
};

const lookup = (table: Record<string, number>, key: string | undefined, fallback: number): number =>
  (key ? table[key] : undefined) ?? fallback;

/**
 * Estimated monthly USD for a resource, or `null` when not modeled.
 *
 * Beyond a flat per-service base, this factors in the config dimensions that
 * actually move spend: instance/node **size**, **count** (ASG capacity, cache
 * nodes, replicas), **multi-AZ** doubling, and **storage GiB**. Still a rough,
 * us-east-1 baseline (no data-transfer, request, or commitment pricing).
 */
export function estimateMonthlyCost(r: ResourceInstance): number | null {
  switch (r.serviceId) {
    case "ec2-instance":
      return lookup(EC2_BY_TYPE, str(r, "instanceType"), BASE_MONTHLY["ec2-instance"]);

    case "auto-scaling-group":
      // Launch template isn't modeled; approximate per-instance × desired capacity.
      return 50 * Math.max(1, num(r, "desiredCapacity", 2));

    case "rds": {
      const perInstance = lookup(RDS_BY_CLASS, str(r, "instanceClass"), BASE_MONTHLY["rds"]);
      const azFactor = r.config["multiAz"] === true ? 2 : 1;
      const storage = num(r, "allocatedStorage", 20) * RDS_STORAGE_GB;
      return perInstance * azFactor + storage;
    }
    case "aurora": {
      const perInstance = lookup(RDS_BY_CLASS, str(r, "instanceClass"), 100);
      return perInstance * (num(r, "replicaCount", 1) + 1); // writer + replicas
    }
    case "documentdb": {
      const perInstance = lookup(RDS_BY_CLASS, str(r, "instanceClass"), BASE_MONTHLY["documentdb"]);
      return perInstance * Math.max(1, num(r, "instanceCount", 1));
    }
    case "elasticache":
      return (
        lookup(CACHE_BY_TYPE, str(r, "nodeType"), BASE_MONTHLY["elasticache"]) *
        Math.max(1, num(r, "numNodes", 1))
      );
    case "memorydb":
      return (
        lookup(CACHE_BY_TYPE, str(r, "nodeType"), BASE_MONTHLY["memorydb"]) *
        Math.max(1, num(r, "numShards", 1)) *
        (num(r, "replicasPerShard", 1) + 1)
      );

    case "ebs-volume":
      return num(r, "sizeGiB", 100) * lookup(EBS_GB_BY_TYPE, str(r, "volumeType"), 0.08);
    case "fsx":
      return num(r, "storageCapacityGiB", 1200) * 0.14;

    case "gcp-compute-engine":
      return lookup(GCP_VM_BY_TYPE, str(r, "machineType"), BASE_MONTHLY["gcp-compute-engine"]);
    case "azure-vm":
      return lookup(AZURE_VM_BY_SIZE, str(r, "vmSize"), BASE_MONTHLY["azure-vm"]);

    default: {
      const base = BASE_MONTHLY[r.serviceId];
      return base === undefined ? null : base;
    }
  }
}

/** Sum of estimable resources (unknowns ignored) + how many were estimated. */
export function estimateTotal(resources: readonly ResourceInstance[]): {
  total: number;
  estimated: number;
  unknown: number;
} {
  let total = 0;
  let estimated = 0;
  let unknown = 0;
  for (const r of resources) {
    const c = estimateMonthlyCost(r);
    if (c === null) unknown++;
    else {
      total += c;
      estimated++;
    }
  }
  return { total, estimated, unknown };
}

/** Compact USD/month label, e.g. "$1.2k/mo", "$32/mo", "free". */
export function formatMonthly(n: number | null): string {
  if (n === null) return "—";
  if (n === 0) return "free";
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k/mo`;
  return `$${Math.round(n)}/mo`;
}
