/**
 * Strata — Service Registry Schema
 * ------------------------------------------
 * The canonical, extensible vocabulary the whole application is built on.
 *
 * Everything visual and behavioural (palette, node colours, icons, config
 * forms, validation, MCP import) is *derived* from these structures rather
 * than hardcoded. To support a new AWS service you add one `ServiceDefinition`
 * — no UI code changes required.
 */

/**
 * Cloud provider a service belongs to. The registry is multi-cloud: AWS is the
 * original (and default) provider, with GCP and Azure added alongside it. See
 * `getServiceByNativeType` for the provider-aware join key used by IaC import/
 * export and live discovery.
 */
export type CloudProvider = "aws" | "gcp" | "azure";

/** Runtime list of every provider, for filters/iteration. */
export const CLOUD_PROVIDERS = ["aws", "gcp", "azure"] as const satisfies readonly CloudProvider[];

/** Top-level grouping used for palette sections, colour coding and filtering. */
export type ServiceCategoryId =
  | "networking"
  | "compute"
  | "containers"
  | "storage"
  | "database"
  | "integration"
  | "security"
  | "identity"
  | "monitoring"
  | "analytics"
  | "ai-ml"
  | "deployment"
  | "management"
  | "edge";

/** The relationship vocabulary used for typed edges between resources. */
export type RelationshipKind =
  | "contains" //  parent → child (VPC contains Subnet)
  | "attached_to" //  resource bound to another (SG attached_to ENI)
  | "routes_to" //  network routing (Route Table routes_to IGW)
  | "depends_on" //  generic logical dependency
  | "allows" //  security rule grants access (SG allows SG)
  | "targets" //  load balancing / forwarding (ALB targets Target Group)
  | "reads_from" //  data read (Lambda reads_from DynamoDB)
  | "writes_to" //  data write (Firehose writes_to S3)
  | "invokes" //  synchronous/async call (API GW invokes Lambda)
  | "publishes_to" //  producer → topic/stream (Service publishes_to SNS)
  | "subscribes_to" //  consumer ← topic/queue (Lambda subscribes_to SQS)
  | "assumes" //  principal assumes IAM Role
  | "grants" //  policy grants permissions to principal
  | "monitors" //  observability (CloudWatch monitors EC2)
  | "peers_with" //  symmetric (VPC peers_with VPC)
  | "connects_to"; //  generic network connection

/** Metadata describing one relationship kind for UI + validation. */
export interface RelationshipDefinition {
  kind: RelationshipKind;
  label: string;
  description: string;
  /** true when the relationship has no inherent direction (peering). */
  symmetric?: boolean;
  /** Suggested dashed vs solid styling hint for the renderer. */
  style?: "solid" | "dashed";
}

/** Supported config-field input types rendered dynamically in the Inspector. */
export type ConfigFieldType =
  | "string"
  | "number"
  | "boolean"
  | "select"
  | "multiselect"
  | "cidr"
  | "text"
  | "arn"
  | "tags";

/** A single configurable property of a service (drives the dynamic form). */
export interface ConfigField {
  key: string;
  label: string;
  type: ConfigFieldType;
  placeholder?: string;
  help?: string;
  required?: boolean;
  /** Default value applied when a resource is created from the palette. */
  default?: string | number | boolean;
  /** Options for select / multiselect. */
  options?: ReadonlyArray<Readonly<{ value: string; label: string }>>;
  /** Optional visual grouping inside the inspector. */
  group?: string;
}

/** A suggested/common connection emitted from this service to another. */
export interface CommonConnection {
  /** Target service id (must exist in the registry). */
  to: string;
  relationship: RelationshipKind;
  description?: string;
}

/**
 * Where a resource conceptually lives. Drives containment, layout and
 * validation (e.g. an EC2 instance must sit inside a Subnet, an S3 bucket is
 * regional, IAM is global).
 */
export type ServiceScope =
  | "global"
  | "region"
  | "az"
  | "vpc"
  | "subnet"
  // ---- multi-cloud additions ----
  /** GCP project / org-level placement (no AWS analog). */
  | "project"
  /** Azure resource group — a mandatory regional container for resources. */
  | "resource-group";

/** The core, reusable definition of a cloud service (any provider). */
export interface ServiceDefinition {
  /** Canonical kebab-case id, stable across versions (e.g. "ec2-instance"). */
  id: string;
  /** Short display name shown on nodes (e.g. "EC2"). */
  name: string;
  /** Full product name (e.g. "Amazon Elastic Compute Cloud"). */
  fullName: string;
  abbreviation?: string;
  /**
   * Cloud provider. Optional for back-compat: an entry without `provider` is
   * treated as `"aws"` by the registry, so the existing AWS catalogs need no
   * edit. GCP/Azure catalogs set it explicitly.
   */
  provider?: CloudProvider;
  category: ServiceCategoryId;
  description: string;
  /** Icon token — currently an emoji, swappable for the AWS icon set later. */
  icon: string;
  /** Conceptual placement of the resource. */
  scope: ServiceScope;
  /** True for services that visually contain other resources (VPC, Subnet…). */
  isContainer?: boolean;
  /** Optional colour override; otherwise the category colour is used. */
  color?: string;
  /** Dynamic configuration schema for the inspector. */
  configFields: ConfigField[];
  /** Suggested outgoing connections (used for hints + auto-wiring). */
  commonConnections: CommonConnection[];
  /** CloudFormation type, also used as the MCP/import discriminator (AWS only). */
  cfnType?: string;
  /**
   * Provider-native canonical resource type — the cross-layer join key for IaC
   * import/export and live discovery, generalising `cfnType` across providers:
   *   - AWS:   CloudFormation type, e.g. "AWS::EC2::Instance" (mirrors cfnType).
   *   - GCP:   Cloud Asset Inventory type, e.g. "compute.googleapis.com/Instance".
   *   - Azure: ARM resource type, e.g. "Microsoft.Compute/virtualMachines".
   * For AWS entries this may be omitted; the registry falls back to `cfnType`.
   */
  nativeType?: string;
  /** The provider-native IaC property names for each modeled config field. */
  cfnPropertyNames?: Record<string, string>;
  /** ARN pattern for reference / parsing imported ARNs (AWS). */
  arnPattern?: string;
  /** Free-text search keywords. */
  keywords?: string[];
  docsUrl?: string;
}

/** Category presentation metadata (colour + icon + copy). */
export interface CategoryDefinition {
  id: ServiceCategoryId;
  name: string;
  description: string;
  /** CSS colour (hex) used for node accenting and the legend. */
  color: string;
  icon: string;
}
