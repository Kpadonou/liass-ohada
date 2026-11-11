import { App, Stack } from "aws-cdk-lib";
import { Template, Match } from "aws-cdk-lib/assertions";
import { HttpApi } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpJwtAuthorizer } from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import { Table, AttributeType } from "aws-cdk-lib/aws-dynamodb";
import { RealTestFiscalExecutor } from "../../../lib/constructs/domains/real-test-fiscal-executor";
jest.mock("aws-cdk-lib/aws-lambda-nodejs", () => {
  const lambda = jest.requireActual<typeof import("aws-cdk-lib/aws-lambda")>("aws-cdk-lib/aws-lambda");
  return { NodejsFunction: class extends lambda.Function { constructor(scope: import("constructs").Construct, id: string, props: import("aws-cdk-lib/aws-lambda").FunctionProps) {
    super(scope, id, { ...props, code: lambda.Code.fromInline("exports.handler = async () => ({statusCode:403})"), handler: "index.handler" });
  } } };
});
function synth(enabled = false) {
  const app = new App({ context: enabled ? { restoFiscalTestEnabled: true, restoFiscalTestOrgId: "org", restoFiscalTestConfigurationSecretArn: "arn:aws:secretsmanager:eu-west-3:123456789012:secret:private-config" } : {} });
  const stack = new Stack(app, "Security", { env: { account: "123456789012", region: "eu-west-3" } });
  const api = new HttpApi(stack, "Api");
  const authorizer = new HttpJwtAuthorizer("JWT", "https://issuer.example", { jwtAudience: ["client"] });
  const table = new Table(stack, "Platform", { partitionKey: { name: "PK", type: AttributeType.STRING }, sortKey: { name: "SK", type: AttributeType.STRING } });
  const restaurantsTable = new Table(stack, "Restaurants", { partitionKey: { name: "PK", type: AttributeType.STRING }, sortKey: { name: "SK", type: AttributeType.STRING } });
  new RealTestFiscalExecutor(stack, "Fiscal", { stage: "dev", api, authorizer, table, restaurantsTable });
  return Template.fromStack(stack);
}
function synthAdjudication() {
  const app = new App({ context: {
    restoFiscalAdjudicationEnabled: true,
    restoFiscalTestOrgId: "org",
    restoFiscalAdjudicationOutletId: "11111111-1111-4111-8111-111111111111",
    restoFiscalAdjudicationSessionId: "22222222-2222-4222-8222-222222222222",
    restoFiscalAdjudicationInvoiceId: "33333333-3333-4333-8333-333333333333",
    restoFiscalAdjudicationReviewerUserId: "44444444-4444-4444-8444-444444444444",
    restoFiscalAdjudicationSellerNim: "TS01002103",
    restoFiscalAdjudicationCaptureReference: "a".repeat(64),
    restoFiscalAdjudicationAuthorizationReference: "PO-DGI-TEST-ADJUDICATION",
  } });
  const stack = new Stack(app, "Security", { env: { account: "123456789012", region: "eu-west-3" } });
  const api = new HttpApi(stack, "Api");
  const authorizer = new HttpJwtAuthorizer("JWT", "https://issuer.example", { jwtAudience: ["client"] });
  const table = new Table(stack, "Platform", { partitionKey: { name: "PK", type: AttributeType.STRING }, sortKey: { name: "SK", type: AttributeType.STRING } });
  const restaurantsTable = new Table(stack, "Restaurants", { partitionKey: { name: "PK", type: AttributeType.STRING }, sortKey: { name: "SK", type: AttributeType.STRING } });
  new RealTestFiscalExecutor(stack, "Fiscal", { stage: "dev", api, authorizer, table, restaurantsTable });
  return Template.fromStack(stack);
}
test("private 30-day SSE-S3 bucket and dedicated write-only execution role", () => {
  const template = synth();
  template.hasResourceProperties("AWS::S3::Bucket", {
    BucketEncryption: { ServerSideEncryptionConfiguration: [{ ServerSideEncryptionByDefault: { SSEAlgorithm: "AES256" } }] },
    PublicAccessBlockConfiguration: { BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true },
    LifecycleConfiguration: { Rules: [{ Status: "Enabled", ExpirationInDays: 30, AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 } }] },
  });
  template.hasResourceProperties("AWS::Lambda::Function", { Environment: { Variables: Match.objectLike({ FISCAL_REAL_TEST_ENABLED: "0" }) } });
  const json = template.toJSON();
  const policies = Object.values(json.Resources).filter((r: unknown) => (r as { Type: string }).Type === "AWS::IAM::Policy") as { Properties: { PolicyDocument: { Statement: { Action: string | string[]; Effect: string; Condition?: unknown }[] } } }[];
  const statements = policies.flatMap(r => r.Properties.PolicyDocument.Statement);
  expect(statements.filter(s => s.Action === "s3:PutObject")).toHaveLength(1);
  expect(JSON.stringify(statements)).not.toMatch(/s3:GetObject|s3:ListBucket|s3:\*/);
  expect(JSON.stringify(statements)).toContain("s3:if-none-match");
  expect(JSON.stringify(statements)).toContain(":log-group:/aws/lambda/liass-ohada-dev-fiscal-compliance-real-test:*");
  const routes = Object.values(json.Resources).filter((r: unknown) => (r as { Type: string }).Type === "AWS::ApiGatewayV2::Route") as { Properties: { AuthorizationType: string } }[];
  expect(routes).toHaveLength(0); expect(routes.every(r => r.Properties.AuthorizationType === "JWT")).toBe(true);
  expect(JSON.stringify(template.findResources("AWS::S3::BucketPolicy"))).toContain("aws:SecureTransport");
});
test("explicit enablement pins organization and secret without broad secret grants", () => {
  const template = synth(true);
  const json = JSON.stringify(template.toJSON());
  expect(json).toContain('"FISCAL_REAL_TEST_ENABLED":"1"'); expect(json).toContain('"FISCAL_TEST_ORG_ID":"org"');
  expect(json).toContain("secretsmanager:GetSecretValue"); expect(json).toContain("dynamodb:LeadingKeys");
});
test("adjudication has a distinct disabled-real-execution gate and one-object reader", () => {
  const template = synthAdjudication();
  const json = JSON.stringify(template.toJSON());
  expect(json).toContain('"FISCAL_REAL_TEST_ENABLED":"0"');
  expect(json).toContain('"FISCAL_ADJUDICATION_ENABLED":"1"');
  expect(json).toContain("s3:GetObject");
  expect(json).toContain("a".repeat(64));
  expect(json).not.toContain("s3:ListBucket");
  expect(json).not.toContain("secretsmanager:GetSecretValue");
});
