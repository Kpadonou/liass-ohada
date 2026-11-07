import { ArnFormat, Duration, RemovalPolicy, Stack } from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as api from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { Construct } from "constructs";
import * as path from "node:path";
import { RESTAURANT_FISCAL_ROUTES } from "../../../lambda/domains/restaurants/fiscal-routes";
export class RealTestFiscalExecutor extends Construct {
  public readonly executionFunction: lambda.IFunction;
  constructor(scope: Construct, id: string, props: { stage: "dev" | "test"; api: api.HttpApi;
    authorizer: api.IHttpRouteAuthorizer; table: dynamodb.ITable; restaurantsTable: dynamodb.ITable }) {
    super(scope, id);
    const enabled = this.node.tryGetContext("restoFiscalTestEnabled") === true;
    const org = this.node.tryGetContext("restoFiscalTestOrgId") as string | undefined;
    const secret = this.node.tryGetContext("restoFiscalTestConfigurationSecretArn") as string | undefined;
    if (enabled && (!org || !secret)) throw new Error("Explicit TEST organization and configuration secret required");
    if (org && !/^[A-Za-z0-9_-]{1,200}$/.test(org)) throw new Error("Invalid TEST organization");
    const bucket = new s3.Bucket(this, "DiagnosticResponses", {
      bucketName: `liass-ohada-${props.stage}-fiscal-test-diagnostics-${Stack.of(this).account}-${Stack.of(this).region}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL, encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true, versioned: false, removalPolicy: RemovalPolicy.RETAIN,
      lifecycleRules: [{ expiration: Duration.days(30), abortIncompleteMultipartUploadAfter: Duration.days(1) }],
    });
    const role = new iam.Role(this, "ExecutionRole", { roleName: `liass-ohada-${props.stage}-fiscal-test-execution`, assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com") });
    const functionName = `liass-ohada-${props.stage}-fiscal-compliance-real-test`;
    const fn = new NodejsFunction(this, "Executor", {
      functionName,
      entry: path.join(__dirname, "../../../lambda/domains/restaurants/real-test-fiscal-handler.ts"),
      runtime: lambda.Runtime.NODEJS_24_X, role, timeout: Duration.seconds(45), memorySize: 256,
      retryAttempts: 0, bundling: { bundleAwsSDK: true },
      environment: { STAGE: props.stage, FISCAL_EXECUTION_MODE: "REAL_TEST", FISCAL_REAL_TEST_ENABLED: enabled ? "1" : "0",
        FISCAL_TEST_ORG_ID: org ?? "", FISCAL_TEST_CONFIGURATION_SECRET_ARN: secret ?? "",
        FISCAL_DIAGNOSTIC_BUCKET: bucket.bucketName, TABLE_NAME: props.table.tableName,
        RESTAURANTS_TABLE_NAME: props.restaurantsTable.tableName },
    });
    role.addToPolicy(new iam.PolicyStatement({ actions: ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"],
      resources: [Stack.of(this).formatArn({ service: "logs", resource: "log-group", resourceName: `/aws/lambda/${functionName}:*`, arnFormat: ArnFormat.COLON_RESOURCE_NAME })] }));
    role.addToPolicy(new iam.PolicyStatement({ actions: ["dynamodb:GetItem", "dynamodb:BatchGetItem"],
      resources: [props.table.tableArn, props.restaurantsTable.tableArn] }));
    role.addToPolicy(new iam.PolicyStatement({ actions: ["dynamodb:Query"], resources: [props.restaurantsTable.tableArn] }));
    role.addToPolicy(new iam.PolicyStatement({ actions: ["dynamodb:PutItem"], resources: [props.table.tableArn],
      conditions: { "ForAllValues:StringEquals": { "dynamodb:LeadingKeys": [`ORG#${org ?? "DISABLED"}`],
        "dynamodb:Attributes": ["PK", "SK", "orgId", "entityType", "schemaVersion", "version", "state"] } } }));
    role.addToPolicy(new iam.PolicyStatement({ actions: ["s3:PutObject"], resources: [bucket.arnForObjects("*")],
      conditions: { StringEquals: { "s3:x-amz-server-side-encryption": "AES256", "s3:if-none-match": "*" } } }));
    if (secret) role.addToPolicy(new iam.PolicyStatement({ actions: ["secretsmanager:GetSecretValue"], resources: [secret] }));
    // No shared role grant, object reader, URL output, or anonymous access.
    this.executionFunction = fn;
  }
}
