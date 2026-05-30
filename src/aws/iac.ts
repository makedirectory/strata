/**
 * Strata — Infrastructure-as-Code import
 * ------------------------------------------------
 * Turns **CloudFormation** templates (JSON or YAML) and **Terraform** configs
 * (`terraform show -json` state / plan JSON) into the in-app
 * `InfrastructureGraph` so existing/declared infrastructure renders as a
 * visual diagram.
 *
 * Join keys:
 *  - CloudFormation: a resource's `Type` (e.g. "AWS::EC2::Instance") IS the
 *    registry `cfnType`, so `getServiceByCfnType` resolves it directly.
 *  - Terraform: the HCL resource type (e.g. "aws_instance") is mapped to a
 *    registry `serviceId` via `TF_TYPE_TO_SERVICE_ID`.
 *
 * Both paths normalise to a common `ResolvedItem[]` and go through the same
 * `buildGraph` builder (config filtering, containment, typed relationships,
 * grid auto-layout, de-duplication). This module is pure and dependency-light
 * (only `js-yaml` for CloudFormation YAML).
 */
import yaml from "js-yaml";
import type { InfrastructureGraph, ResourceInstance, Relationship } from "./model";
import { emptyGraph, DEFAULT_NODE_SIZE } from "./model";
import type { RelationshipKind } from "./types";
import { getService, getServiceByCfnType } from "./registry";

export type IacFormat = "cloudformation" | "terraform";

export interface IacImportResult {
  graph: InfrastructureGraph;
  format: IacFormat;
  /** Source resource types with no registry mapping (candidates for the catalog). */
  unmappedTypes: string[];
  /** Non-fatal notes surfaced to the user (skipped resources, ambiguities…). */
  warnings: string[];
}

/** A source resource normalised to a registry serviceId, before graph assembly. */
interface ResolvedItem {
  id: string;
  serviceId: string;
  name: string;
  parentId?: string;
  properties?: Record<string, unknown>;
  relationships: { to: string; kind: RelationshipKind }[];
}

// ---------------------------------------------------------------------------
// Shared graph builder
// ---------------------------------------------------------------------------

const COLS = 5;
const COL_GAP = 80;
const ROW_GAP = 60;
const ORIGIN = 80;

/**
 * Assemble a renderable graph from resolved items: filters config to the
 * service's known fields, lays nodes out on a grid, and emits typed
 * relationships (de-duplicated, self-loops and dangling targets dropped).
 */
function buildGraph(items: ResolvedItem[], name: string): InfrastructureGraph {
  const graph = emptyGraph(name);
  const ids = new Set(items.map((i) => i.id));

  graph.resources = items.map((item, index) => {
    const svc = getService(item.serviceId);
    const config: Record<string, unknown> = {};
    if (svc && item.properties) {
      for (const f of svc.configFields) {
        if (Object.prototype.hasOwnProperty.call(item.properties, f.key)) {
          config[f.key] = item.properties[f.key];
        }
      }
    }
    const col = index % COLS;
    const row = Math.floor(index / COLS);
    const resource: ResourceInstance = {
      id: item.id,
      serviceId: item.serviceId,
      name: item.name,
      source: "imported",
      config,
      position: {
        x: ORIGIN + col * (DEFAULT_NODE_SIZE.w + COL_GAP),
        y: ORIGIN + row * (DEFAULT_NODE_SIZE.h + ROW_GAP),
        w: DEFAULT_NODE_SIZE.w,
        h: DEFAULT_NODE_SIZE.h,
      },
    };
    // Only keep a parent reference that resolves to another imported resource.
    if (item.parentId && ids.has(item.parentId) && item.parentId !== item.id) {
      resource.parentId = item.parentId;
    }
    return resource;
  });

  const seen = new Set<string>();
  const relationships: Relationship[] = [];
  for (const item of items) {
    for (const rel of item.relationships) {
      if (rel.to === item.id || !ids.has(rel.to)) continue; // self-loop / dangling
      const key = `${item.id}|${rel.to}|${rel.kind}`;
      if (seen.has(key)) continue;
      seen.add(key);
      relationships.push({
        id: `${item.id}-${rel.to}-${rel.kind}`,
        from: item.id,
        to: rel.to,
        kind: rel.kind,
        source: "imported",
      });
    }
  }
  graph.relationships = relationships;
  return graph;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// ---------------------------------------------------------------------------
// CloudFormation
// ---------------------------------------------------------------------------

/**
 * Child-resource properties whose value is a reference to the *containing*
 * resource. Used to derive `parentId` (so subnets nest under their VPC, etc.).
 * Order matters: the most specific container wins.
 */
const CFN_CONTAINMENT_PROPS = ["SubnetId", "VpcId", "ClusterArn", "Cluster", "LoadBalancerArn"];

/** Extract a logical id from a CloudFormation `Ref` / `Fn::GetAtt` value. */
function cfnRefTarget(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.Ref === "string") return value.Ref;
  const getAtt = value["Fn::GetAtt"];
  if (Array.isArray(getAtt) && typeof getAtt[0] === "string") return getAtt[0];
  if (typeof getAtt === "string") return getAtt.split(".")[0];
  return undefined;
}

/** Recursively collect every logical id referenced anywhere in a value. */
function collectCfnRefs(value: unknown, into: Set<string>): void {
  if (Array.isArray(value)) {
    for (const v of value) collectCfnRefs(v, into);
    return;
  }
  if (!isRecord(value)) return;
  const direct = cfnRefTarget(value);
  if (direct) into.add(direct);
  for (const v of Object.values(value)) collectCfnRefs(v, into);
}

export function importCloudFormation(
  template: unknown,
  name = "CloudFormation Import",
): IacImportResult {
  const warnings: string[] = [];
  if (!isRecord(template) || !isRecord(template.Resources)) {
    throw new Error("Not a CloudFormation template: missing top-level 'Resources'.");
  }
  const resources = template.Resources;
  const logicalIds = new Set(Object.keys(resources));
  const items: ResolvedItem[] = [];
  const unmapped = new Set<string>();

  for (const [logicalId, raw] of Object.entries(resources)) {
    if (!isRecord(raw) || typeof raw.Type !== "string") continue;
    const cfnType = raw.Type;
    const svc = getServiceByCfnType(cfnType);
    if (!svc) {
      unmapped.add(cfnType);
      continue;
    }
    const props = isRecord(raw.Properties) ? raw.Properties : {};

    // Containment: first matching containment property that points at another
    // resource in this template.
    let parentId: string | undefined;
    for (const key of CFN_CONTAINMENT_PROPS) {
      const ref = cfnRefTarget(props[key]);
      if (ref && logicalIds.has(ref) && ref !== logicalId) {
        parentId = ref;
        break;
      }
    }

    // Relationships: explicit DependsOn + any other in-template Ref/GetAtt
    // (excluding the containment parent, which is modeled via parentId).
    const refs = new Set<string>();
    collectCfnRefs(props, refs);
    const dependsOn = Array.isArray(raw.DependsOn)
      ? raw.DependsOn.filter((d): d is string => typeof d === "string")
      : typeof raw.DependsOn === "string"
        ? [raw.DependsOn]
        : [];
    const rels: ResolvedItem["relationships"] = [];
    const addRel = (to: string, kind: RelationshipKind) => {
      if (to !== logicalId && logicalIds.has(to) && to !== parentId) rels.push({ to, kind });
    };
    for (const d of dependsOn) addRel(d, "depends_on");
    for (const ref of refs) addRel(ref, "depends_on");

    items.push({
      id: logicalId,
      serviceId: svc.id,
      name: logicalId,
      parentId,
      properties: props,
      relationships: rels,
    });
  }

  if (items.length === 0) {
    warnings.push("No resources matched the service registry — nothing to render.");
  }
  if (unmapped.size > 0) {
    warnings.push(
      `${unmapped.size} resource type(s) are not yet in the registry and were skipped.`,
    );
  }
  return {
    graph: buildGraph(items, name),
    format: "cloudformation",
    unmappedTypes: [...unmapped],
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Terraform (terraform show -json: state or plan)
// ---------------------------------------------------------------------------

/**
 * Terraform HCL resource type → registry serviceId. Terraform does not carry
 * CloudFormation types, so this is the join table for the Terraform path.
 * Extend freely as the catalog grows.
 */
export const TF_TYPE_TO_SERVICE_ID: Record<string, string> = {
  aws_vpc: "vpc",
  aws_subnet: "subnet-private",
  aws_route_table: "route-table",
  aws_network_acl: "nacl",
  aws_internet_gateway: "internet-gateway",
  aws_nat_gateway: "nat-gateway",
  aws_security_group: "security-group",
  aws_lb: "elastic-load-balancer",
  aws_alb: "elastic-load-balancer",
  aws_elb: "elastic-load-balancer",
  aws_lb_target_group: "target-group",
  aws_alb_target_group: "target-group",
  aws_route53_zone: "route53",
  aws_route53_record: "route53",
  aws_vpc_peering_connection: "vpc-peering",
  aws_ec2_transit_gateway: "transit-gateway",
  aws_vpc_endpoint: "vpc-endpoint",
  aws_instance: "ec2-instance",
  aws_lambda_function: "lambda",
  aws_autoscaling_group: "auto-scaling-group",
  aws_batch_compute_environment: "batch",
  aws_batch_job_definition: "batch",
  aws_lightsail_instance: "lightsail",
  aws_elastic_beanstalk_environment: "elastic-beanstalk",
  aws_elastic_beanstalk_application: "elastic-beanstalk",
  aws_ecs_cluster: "ecs-cluster",
  aws_ecs_service: "ecs-service",
  aws_eks_cluster: "eks-cluster",
  aws_ecr_repository: "ecr",
  aws_apprunner_service: "app-runner",
  aws_s3_bucket: "s3-bucket",
  aws_ebs_volume: "ebs-volume",
  aws_efs_file_system: "efs",
  aws_fsx_lustre_file_system: "fsx",
  aws_fsx_windows_file_system: "fsx",
  aws_storagegateway_gateway: "storage-gateway",
  aws_backup_vault: "aws-backup",
  aws_backup_plan: "aws-backup",
  aws_glacier_vault: "s3-glacier",
  aws_db_instance: "rds",
  aws_rds_cluster: "aurora",
  aws_dynamodb_table: "dynamodb",
  aws_elasticache_cluster: "elasticache",
  aws_elasticache_replication_group: "elasticache",
  aws_docdb_cluster: "documentdb",
  aws_neptune_cluster: "neptune",
  aws_memorydb_cluster: "memorydb",
  aws_sqs_queue: "sqs",
  aws_sns_topic: "sns",
  aws_cloudwatch_event_rule: "eventbridge",
  aws_cloudwatch_event_bus: "eventbridge",
  aws_kinesis_stream: "kinesis-data-streams",
  aws_sfn_state_machine: "step-functions",
  aws_api_gateway_rest_api: "api-gateway",
  aws_apigatewayv2_api: "api-gateway",
  aws_mq_broker: "amazon-mq",
  aws_appsync_graphql_api: "appsync",
  aws_secretsmanager_secret: "secrets-manager",
  aws_kms_key: "kms",
  aws_wafv2_web_acl: "waf",
  aws_waf_web_acl: "waf",
  aws_shield_protection: "shield",
  aws_guardduty_detector: "guardduty",
  aws_acm_certificate: "acm",
  aws_cognito_user_pool: "cognito",
  aws_securityhub_account: "security-hub",
  aws_inspector2_enabler: "inspector",
  aws_iam_role: "iam-role",
  aws_iam_user: "iam-user",
  aws_iam_policy: "iam-policy",
  aws_iam_group: "iam-group",
  aws_ssoadmin_permission_set: "iam-identity-center",
  aws_cloudwatch_metric_alarm: "cloudwatch-alarm",
  aws_cloudwatch_log_group: "cloudwatch-logs",
  aws_cloudwatch_dashboard: "cloudwatch",
  aws_xray_sampling_rule: "x-ray",
  aws_cloudtrail: "cloudtrail",
  aws_athena_workgroup: "athena",
  aws_glue_job: "glue",
  aws_glue_crawler: "glue",
  aws_redshift_cluster: "redshift",
  aws_emr_cluster: "emr",
  aws_kinesis_firehose_delivery_stream: "kinesis-firehose",
  aws_quicksight_dashboard: "quicksight",
  aws_opensearch_domain: "opensearch",
  aws_elasticsearch_domain: "opensearch",
  aws_lakeformation_resource: "lake-formation",
  aws_msk_cluster: "msk",
  aws_sagemaker_endpoint: "sagemaker",
  aws_sagemaker_notebook_instance: "sagemaker",
  aws_codepipeline: "codepipeline",
  aws_codebuild_project: "codebuild",
  aws_codedeploy_app: "codedeploy",
  aws_codecommit_repository: "codecommit",
  aws_cloudformation_stack: "cloudformation",
  aws_amplify_app: "amplify",
  aws_organizations_organization: "organizations",
  aws_organizations_account: "organizations",
  aws_config_configuration_recorder: "aws-config",
  aws_ssm_parameter: "systems-manager",
  aws_ssm_document: "systems-manager",
  aws_cloudfront_distribution: "cloudfront",
  aws_globalaccelerator_accelerator: "global-accelerator",
};

interface TfResource {
  address: string;
  type: string;
  name?: string;
  values?: Record<string, unknown>;
  depends_on?: string[];
}

interface TfModule {
  resources?: TfResource[];
  child_modules?: TfModule[];
}

function walkTfModule(module: TfModule | undefined, out: TfResource[]): void {
  if (!module) return;
  for (const r of module.resources ?? []) out.push(r);
  for (const cm of module.child_modules ?? []) walkTfModule(cm, out);
}

export function importTerraform(tf: unknown, name = "Terraform Import"): IacImportResult {
  const warnings: string[] = [];
  if (!isRecord(tf)) throw new Error("Not a Terraform JSON document.");

  // Support `terraform show -json` (state under values, plan under planned_values)
  // and `terraform plan -json` (resource_changes).
  const collected: TfResource[] = [];
  const rootModule =
    (isRecord(tf.values) && (tf.values.root_module as TfModule)) ||
    (isRecord(tf.planned_values) && (tf.planned_values.root_module as TfModule)) ||
    undefined;
  if (rootModule) {
    walkTfModule(rootModule, collected);
  } else if (Array.isArray(tf.resource_changes)) {
    for (const rc of tf.resource_changes) {
      if (!isRecord(rc) || typeof rc.type !== "string") continue;
      const change = isRecord(rc.change) ? rc.change : {};
      collected.push({
        address: typeof rc.address === "string" ? rc.address : `${rc.type}.${String(rc.name)}`,
        type: rc.type,
        name: typeof rc.name === "string" ? rc.name : undefined,
        values: isRecord(change.after) ? (change.after as Record<string, unknown>) : {},
        depends_on: [],
      });
    }
  } else {
    throw new Error(
      "Unrecognised Terraform JSON: expected `values`/`planned_values.root_module` or `resource_changes`.",
    );
  }

  // Map a concrete resource `id` attribute -> address, so containment links
  // (vpc_id/subnet_id holding a resolved id) can resolve to a parent address.
  const idToAddress = new Map<string, string>();
  for (const r of collected) {
    const rid = r.values?.id;
    if (typeof rid === "string") idToAddress.set(rid, r.address);
  }

  const items: ResolvedItem[] = [];
  const unmapped = new Set<string>();
  const addresses = new Set(collected.map((r) => r.address));

  for (const r of collected) {
    const serviceId = TF_TYPE_TO_SERVICE_ID[r.type];
    if (!serviceId) {
      unmapped.add(r.type);
      continue;
    }
    const values = r.values ?? {};
    // Containment from a resolved vpc_id/subnet_id pointing at a known resource.
    let parentId: string | undefined;
    for (const key of ["subnet_id", "vpc_id"]) {
      const v = values[key];
      if (typeof v === "string" && idToAddress.has(v)) {
        parentId = idToAddress.get(v);
        break;
      }
    }
    const rels: ResolvedItem["relationships"] = [];
    for (const dep of r.depends_on ?? []) {
      if (typeof dep === "string" && addresses.has(dep) && dep !== r.address && dep !== parentId) {
        rels.push({ to: dep, kind: "depends_on" });
      }
    }
    items.push({
      id: r.address,
      serviceId,
      name: r.name ?? r.address,
      parentId,
      properties: values,
      relationships: rels,
    });
  }

  if (items.length === 0)
    warnings.push("No resources matched the service registry — nothing to render.");
  if (unmapped.size > 0)
    warnings.push(
      `${unmapped.size} Terraform resource type(s) are not yet mapped and were skipped.`,
    );
  return {
    graph: buildGraph(items, name),
    format: "terraform",
    unmappedTypes: [...unmapped],
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Entry point with format auto-detection
// ---------------------------------------------------------------------------

/**
 * Parse CloudFormation YAML, tolerating the short-form intrinsic tags
 * (`!Ref`, `!GetAtt`, `!Sub`, …) by mapping each to its `Fn::`/`Ref` object
 * form so the rest of the importer sees a uniform structure.
 */
const CFN_TAGS = [
  "Ref",
  "Condition",
  "Base64",
  "Cidr",
  "FindInMap",
  "GetAtt",
  "GetAZs",
  "ImportValue",
  "Join",
  "Select",
  "Split",
  "Sub",
  "Transform",
  "And",
  "Equals",
  "If",
  "Not",
  "Or",
];

function cfnYamlSchema(): yaml.Schema {
  const types: yaml.Type[] = [];
  for (const tag of CFN_TAGS) {
    for (const kind of ["scalar", "sequence", "mapping"] as const) {
      types.push(
        new yaml.Type(`!${tag}`, {
          kind,
          construct: (data) => (tag === "Ref" ? { Ref: data } : { [`Fn::${tag}`]: data }),
        }),
      );
    }
  }
  return yaml.DEFAULT_SCHEMA.extend(types);
}

/** Parse a JSON or (CloudFormation-flavoured) YAML string into an object. */
function parseDocument(content: string): unknown {
  const trimmed = content.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return JSON.parse(trimmed);
  }
  return yaml.load(trimmed, { schema: cfnYamlSchema() });
}

/**
 * Import IaC from a raw string (JSON or YAML), auto-detecting the format unless
 * forced. Returns the renderable graph plus unmapped types and warnings.
 */
export function importIaC(
  content: string,
  opts: { format?: IacFormat | "auto"; name?: string } = {},
): IacImportResult {
  const doc = parseDocument(content);
  const format = opts.format && opts.format !== "auto" ? opts.format : detectFormat(doc);
  if (format === "cloudformation")
    return importCloudFormation(doc, opts.name ?? "CloudFormation Import");
  return importTerraform(doc, opts.name ?? "Terraform Import");
}

/** Heuristically classify a parsed document as CloudFormation or Terraform. */
export function detectFormat(doc: unknown): IacFormat {
  if (isRecord(doc)) {
    if (isRecord(doc.Resources) || typeof doc.AWSTemplateFormatVersion === "string") {
      return "cloudformation";
    }
    if (
      "values" in doc ||
      "planned_values" in doc ||
      "resource_changes" in doc ||
      "terraform_version" in doc ||
      "format_version" in doc
    ) {
      return "terraform";
    }
  }
  throw new Error(
    "Could not detect IaC format. Provide CloudFormation (with 'Resources') or Terraform `show -json` output.",
  );
}
