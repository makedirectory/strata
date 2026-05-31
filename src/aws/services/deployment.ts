/**
 * Developer Tools & Deployment service catalog.
 * Every entry is a `ServiceDefinition` and the array is the default export,
 * matching the structure of networking.ts.
 */
import type { ServiceDefinition } from "../types";

const deployment: ServiceDefinition[] = [
  {
    id: "codepipeline",
    name: "CodePipeline",
    fullName: "AWS CodePipeline",
    category: "deployment",
    description: "Fully managed continuous delivery service that automates release pipelines.",
    icon: "🚦",
    scope: "region",
    cfnType: "AWS::CodePipeline::Pipeline",
    arnPattern: "arn:aws:codepipeline:{region}:{account}:{name}",
    keywords: ["pipeline", "ci/cd", "release", "continuous delivery", "automation"],
    configFields: [
      {
        key: "pipelineType",
        label: "Pipeline Type",
        type: "select",
        default: "V2",
        options: [
          { value: "V1", label: "V1" },
          { value: "V2", label: "V2" },
        ],
      },
      {
        key: "executionMode",
        label: "Execution Mode",
        type: "select",
        default: "QUEUED",
        options: [
          { value: "QUEUED", label: "Queued" },
          { value: "SUPERSEDED", label: "Superseded" },
          { value: "PARALLEL", label: "Parallel" },
        ],
      },
      {
        key: "artifactBucket",
        label: "Artifact Bucket",
        type: "string",
        placeholder: "my-pipeline-artifacts",
      },
    ],
    commonConnections: [
      {
        to: "codecommit",
        relationship: "reads_from",
        description: "Source stage pulls from repository",
      },
      { to: "codebuild", relationship: "invokes", description: "Build stage runs a build project" },
      {
        to: "codedeploy",
        relationship: "invokes",
        description: "Deploy stage triggers a deployment",
      },
      { to: "s3-bucket", relationship: "writes_to", description: "Stores pipeline artifacts" },
    ],
  },
  {
    id: "codebuild",
    name: "CodeBuild",
    fullName: "AWS CodeBuild",
    category: "deployment",
    description:
      "Fully managed build service that compiles source, runs tests and produces artifacts.",
    icon: "🔨",
    scope: "region",
    cfnType: "AWS::CodeBuild::Project",
    arnPattern: "arn:aws:codebuild:{region}:{account}:project/{name}",
    keywords: ["build", "compile", "test", "ci", "buildspec"],
    configFields: [
      {
        key: "environmentType",
        label: "Environment Type",
        type: "select",
        default: "LINUX_CONTAINER",
        options: [
          { value: "LINUX_CONTAINER", label: "Linux Container" },
          { value: "LINUX_GPU_CONTAINER", label: "Linux GPU Container" },
          { value: "ARM_CONTAINER", label: "ARM Container" },
          { value: "WINDOWS_SERVER_2019_CONTAINER", label: "Windows Server 2019" },
        ],
      },
      {
        key: "computeType",
        label: "Compute Type",
        type: "select",
        default: "BUILD_GENERAL1_SMALL",
        options: [
          { value: "BUILD_GENERAL1_SMALL", label: "Small (3 GB / 2 vCPU)" },
          { value: "BUILD_GENERAL1_MEDIUM", label: "Medium (7 GB / 4 vCPU)" },
          { value: "BUILD_GENERAL1_LARGE", label: "Large (15 GB / 8 vCPU)" },
        ],
      },
      {
        key: "image",
        label: "Image",
        type: "string",
        placeholder: "aws/codebuild/amazonlinux2-x86_64-standard:5.0",
      },
    ],
    commonConnections: [
      { to: "codecommit", relationship: "reads_from", description: "Pulls source to build" },
      { to: "ecr", relationship: "writes_to", description: "Pushes built container images" },
      { to: "s3-bucket", relationship: "writes_to", description: "Uploads build artifacts" },
      { to: "cloudwatch-logs", relationship: "writes_to", description: "Streams build logs" },
    ],
  },
  {
    id: "codedeploy",
    name: "CodeDeploy",
    fullName: "AWS CodeDeploy",
    category: "deployment",
    description: "Automates application deployments to EC2, Lambda, ECS and on-premises servers.",
    icon: "🚢",
    scope: "region",
    cfnType: "AWS::CodeDeploy::DeploymentGroup",
    arnPattern: "arn:aws:codedeploy:{region}:{account}:deploymentgroup:{name}",
    keywords: ["deploy", "deployment", "blue/green", "rollout", "appspec"],
    configFields: [
      {
        key: "computePlatform",
        label: "Compute Platform",
        type: "select",
        default: "Server",
        options: [
          { value: "Server", label: "EC2/On-premises" },
          { value: "Lambda", label: "AWS Lambda" },
          { value: "ECS", label: "Amazon ECS" },
        ],
      },
      {
        key: "deploymentType",
        label: "Deployment Type",
        type: "select",
        default: "IN_PLACE",
        options: [
          { value: "IN_PLACE", label: "In-place" },
          { value: "BLUE_GREEN", label: "Blue/Green" },
        ],
      },
      {
        key: "deploymentConfig",
        label: "Deployment Config",
        type: "select",
        default: "CodeDeployDefault.OneAtATime",
        options: [
          { value: "CodeDeployDefault.AllAtOnce", label: "All at once" },
          { value: "CodeDeployDefault.HalfAtATime", label: "Half at a time" },
          { value: "CodeDeployDefault.OneAtATime", label: "One at a time" },
        ],
      },
    ],
    commonConnections: [
      {
        to: "ec2-instance",
        relationship: "writes_to",
        description: "Deploys revisions to instances",
      },
      {
        to: "lambda",
        relationship: "writes_to",
        description: "Shifts traffic to new Lambda versions",
      },
      { to: "ecs-service", relationship: "writes_to", description: "Deploys to ECS task sets" },
      {
        to: "auto-scaling-group",
        relationship: "writes_to",
        description: "Targets instances in an ASG",
      },
    ],
  },
  {
    id: "codecommit",
    name: "CodeCommit",
    fullName: "AWS CodeCommit",
    category: "deployment",
    description: "Fully managed, private Git repository hosting service.",
    icon: "🔖",
    scope: "region",
    cfnType: "AWS::CodeCommit::Repository",
    arnPattern: "arn:aws:codecommit:{region}:{account}:{name}",
    keywords: ["git", "repository", "source control", "version control", "repo"],
    configFields: [
      {
        key: "repositoryName",
        label: "Repository Name",
        type: "string",
        placeholder: "my-app",
        required: true,
      },
      { key: "defaultBranch", label: "Default Branch", type: "string", default: "main" },
      {
        key: "description",
        label: "Description",
        type: "text",
        placeholder: "Application source repository",
      },
    ],
    commonConnections: [
      {
        to: "codepipeline",
        relationship: "invokes",
        description: "Pushes trigger pipeline executions",
      },
      { to: "codebuild", relationship: "connects_to", description: "Provides source for builds" },
      { to: "sns", relationship: "publishes_to", description: "Sends repository notifications" },
    ],
  },
  {
    id: "cloudformation",
    name: "CloudFormation",
    fullName: "AWS CloudFormation",
    abbreviation: "CFN",
    category: "deployment",
    description: "Provisions and manages AWS resources as code through declarative templates.",
    icon: "📐",
    scope: "region",
    cfnType: "AWS::CloudFormation::Stack",
    arnPattern: "arn:aws:cloudformation:{region}:{account}:stack/{name}/{id}",
    keywords: ["iac", "infrastructure as code", "stack", "template", "provisioning"],
    configFields: [
      {
        key: "stackName",
        label: "Stack Name",
        type: "string",
        placeholder: "my-stack",
        required: true,
      },
      {
        key: "templateFormat",
        label: "Template Format",
        type: "select",
        default: "yaml",
        options: [
          { value: "yaml", label: "YAML" },
          { value: "json", label: "JSON" },
        ],
      },
      {
        key: "capabilities",
        label: "Capabilities",
        type: "multiselect",
        options: [
          { value: "CAPABILITY_IAM", label: "CAPABILITY_IAM" },
          { value: "CAPABILITY_NAMED_IAM", label: "CAPABILITY_NAMED_IAM" },
          { value: "CAPABILITY_AUTO_EXPAND", label: "CAPABILITY_AUTO_EXPAND" },
        ],
      },
      { key: "rollbackOnFailure", label: "Rollback on Failure", type: "boolean", default: true },
    ],
    commonConnections: [
      {
        to: "iam-role",
        relationship: "assumes",
        description: "Uses a service role to provision resources",
      },
      {
        to: "sns",
        relationship: "publishes_to",
        description: "Publishes stack event notifications",
      },
      { to: "s3-bucket", relationship: "reads_from", description: "Reads templates and artifacts" },
    ],
  },
  {
    id: "amplify",
    name: "Amplify",
    fullName: "AWS Amplify",
    category: "deployment",
    description: "Hosts and builds full-stack web and mobile apps with managed CI/CD.",
    icon: "🟧",
    scope: "region",
    cfnType: "AWS::Amplify::App",
    arnPattern: "arn:aws:amplify:{region}:{account}:apps/{id}",
    keywords: ["amplify", "frontend", "hosting", "web app", "ci/cd"],
    configFields: [
      {
        key: "platform",
        label: "Platform",
        type: "select",
        default: "WEB",
        options: [
          { value: "WEB", label: "Web" },
          { value: "WEB_COMPUTE", label: "Web Compute (SSR)" },
          { value: "WEB_DYNAMIC", label: "Web Dynamic" },
        ],
      },
      {
        key: "repository",
        label: "Repository URL",
        type: "string",
        placeholder: "https://github.com/org/repo",
      },
      { key: "branch", label: "Branch", type: "string", default: "main" },
    ],
    commonConnections: [
      {
        to: "codecommit",
        relationship: "reads_from",
        description: "Connects to a source repository",
      },
      { to: "cloudfront", relationship: "connects_to", description: "Serves content via the CDN" },
      {
        to: "appsync",
        relationship: "connects_to",
        description: "Backs the app with a GraphQL API",
      },
      { to: "cognito", relationship: "connects_to", description: "Provides app authentication" },
    ],
  },
];

export default deployment;
