# Mock data for visual testing

Sample files for exercising Strata's import/visualization paths.

| File                         | Upload via                       | What it tests                                                                         |
| ---------------------------- | -------------------------------- | ------------------------------------------------------------------------------------- |
| `multicloud-showcase.json`   | **Import JSON**                  | All three provider badges (AWS / GCP / Azure) side by side                            |
| `aws-three-tier.json`        | **Import JSON**                  | A realistic AWS layout — containment, routing, targeting, and data-flow edges         |
| `cloudformation-sample.json` | **Import IaC**                   | The CloudFormation parser → graph conversion (a different code path from native JSON) |
| `arm-sample.json`            | **Import IaC** — Azure ARM       | ARM-vs-CloudFormation detection + `dependsOn` edges                                   |
| `terraform-aws-state.json`   | **Import IaC** — Terraform state | Containment inferred from `vpc_id` / `subnet_id` references                           |

## Larger-scale examples

Bigger native graphs (all **Import JSON**) for seeing what real-world-sized infrastructure looks like on the canvas. They open zoomed-out (`viewport.scale`) so the whole topology is visible at once.

| File                                | Resources / edges | What it shows                                                                                                                                                                                          |
| ----------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `aws-microservices-platform.json`   | 36 / 44           | Production multi-AZ AWS stack: edge (Route 53/CloudFront/WAF) → ALB → ECS services, Aurora/ElastiCache/DynamoDB, async messaging (SQS/SNS/EventBridge/Step Functions/Lambda), security + observability |
| `aws-serverless-data-pipeline.json` | 22 / 24           | Event-driven serverless ingestion + analytics: Cognito → API Gateway → Lambda/DynamoDB, Kinesis → Firehose → S3, EventBridge → Step Functions, and a Glue/Athena/QuickSight path                       |
| `multicloud-enterprise.json`        | 26 / 19           | A full networking/compute/data/storage tier in **each** of AWS, GCP and Azure, with cross-cloud connectivity — all three badges at scale                                                               |

**Import JSON** expects a native `InfrastructureGraph` (`src/aws/model.ts`) and replaces the whole canvas.
**Import IaC** auto-detects CloudFormation / ARM / Terraform and converts to a graph.

Note: a node's provider badge comes from its `serviceId` (resolved against the registry), not from a field on the resource itself — so the `serviceId` strings in these files must match real registry entries.
