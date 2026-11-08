import { App, Stack } from "aws-cdk-lib";
import { HttpApi } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpJwtAuthorizer } from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import { Table, AttributeType } from "aws-cdk-lib/aws-dynamodb";
import { Template } from "aws-cdk-lib/assertions";
import { PlatformFiscalityEndpoints } from "../../../lib/constructs/domains/platform-fiscality-endpoints";
jest.mock("aws-cdk-lib/aws-lambda-nodejs", () => {
  const lambda = jest.requireActual<typeof import("aws-cdk-lib/aws-lambda")>(
    "aws-cdk-lib/aws-lambda",
  );
  return {
    NodejsFunction: class extends lambda.Function {
      constructor(
        scope: import("constructs").Construct,
        id: string,
        props: import("aws-cdk-lib/aws-lambda").FunctionProps,
      ) {
        super(scope, id, {
          ...props,
          code: lambda.Code.fromInline(
            "exports.handler = async () => ({statusCode:403})",
          ),
          handler: "index.handler",
        });
      }
    },
  };
});

test("SFE role can read tenant membership only within organization partitions", () => {
  const app = new App();
  const stack = new Stack(app, "Test");
  const issuer =
    "https://cognito-idp.eu-west-3.amazonaws.com/eu-west-3_verified";
  const api = new HttpApi(stack, "Api", {
    defaultAuthorizer: new HttpJwtAuthorizer("JWT", issuer, {
      jwtAudience: ["client"],
    }),
  });
  const table = new Table(stack, "ExistingTable", {
    partitionKey: { name: "PK", type: AttributeType.STRING },
    sortKey: { name: "SK", type: AttributeType.STRING },
  });
  new PlatformFiscalityEndpoints(stack, "Fiscality", {
    api,
    table,
    stage: "dev",
    cognitoIssuer: issuer,
  });

  const policies = Template.fromStack(stack).findResources("AWS::IAM::Policy");
  const sfePolicy = Object.entries(policies).find(([name]) =>
    name.includes("SfeReferenceRole"),
  )?.[1];
  expect(sfePolicy).toBeDefined();
  const statements = sfePolicy!.Properties.PolicyDocument.Statement;
  expect(statements).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        Effect: "Allow",
        Action: "dynamodb:GetItem",
        Condition: {
          "ForAllValues:StringLike": {
            "dynamodb:LeadingKeys": ["ORG#*"],
          },
        },
      }),
    ]),
  );
});

test("SFE APIs reuse JWT, API and table; role can condition-check but never mutate administrator grants", () => {
  const app = new App();
  const stack = new Stack(app, "Test");
  const issuer =
    "https://cognito-idp.eu-west-3.amazonaws.com/eu-west-3_verified";
  const authorizer = new HttpJwtAuthorizer("JWT", issuer, {
    jwtAudience: ["client"],
  });
  const api = new HttpApi(stack, "Api", { defaultAuthorizer: authorizer });
  const table = new Table(stack, "ExistingTable", {
    partitionKey: { name: "PK", type: AttributeType.STRING },
    sortKey: { name: "SK", type: AttributeType.STRING },
  });
  new PlatformFiscalityEndpoints(stack, "Fiscality", {
    api,
    table,
    stage: "dev",
    cognitoIssuer: issuer,
  });
  const template = Template.fromStack(stack);
  const routes = Object.values(
    template.findResources("AWS::ApiGatewayV2::Route"),
  );
  expect(routes.map((route) => route.Properties.RouteKey).sort()).toEqual(
    [
      "GET /me/organization/fiscality/sfe-approval",
      "PUT /platform/fiscality/sfe-approval",
      "GET /me/organization/fiscality/connections",
      "PUT /me/organization/fiscality/connections/{connectionId}",
      "PUT /me/organization/fiscality/connections/{connectionId}/credential",
      "DELETE /me/organization/fiscality/connections/{connectionId}/credential",
      "POST /me/organization/fiscality/connections/{connectionId}/verification",
    ].sort(),
  );
  expect(
    routes.every((route) => route.Properties.AuthorizationType === "JWT"),
  ).toBe(true);
  const policy = JSON.stringify(template.findResources("AWS::IAM::Policy"));
  expect(policy).toContain("dynamodb:ConditionCheckItem");
  expect(policy).toContain("PLATFORM_SFE#dev#BJ");
  expect(policy).toContain("PLATFORM_ADMIN#dev#*");
  expect(policy).toContain('"Effect":"Deny"');
  expect(policy).toContain("PLATFORM_ADMIN#*");
  expect(policy).toContain("ssm:PutParameter");
  expect(policy).toContain("ssm:GetParameter");
  expect(policy).toContain("ssm:Overwrite");
  expect(policy).toContain('"StringEquals":{"ssm:Overwrite":"false"}');
  expect(policy).not.toContain('"Bool":{"ssm:Overwrite"');
  expect(policy).not.toContain("ssm:GetParametersByPath");
  expect(policy).not.toContain("ssm:DeleteParameter");
  expect(policy).not.toContain("secretsmanager:");
  expect(
    Object.keys(template.findResources("AWS::DynamoDB::Table")),
  ).toHaveLength(1); // fixture only
  expect(
    Object.keys(template.findResources("AWS::Cognito::UserPool")),
  ).toHaveLength(0);
  expect(Object.keys(template.findResources("AWS::S3::Bucket"))).toHaveLength(
    0,
  );
  const functions = Object.values(
    template.findResources("AWS::Lambda::Function"),
  );
  const verifier = functions.find((fn) =>
    fn.Properties.FunctionName.endsWith("verify-fiscal-connection"),
  )!;
  expect(
    verifier.Properties.Environment.Variables
      .FISCAL_CREDENTIAL_TEST_VERIFICATION_ENABLED,
  ).toBe("0");
  expect(verifier.Properties.Timeout).toBe(30);
  const policies = template.findResources("AWS::IAM::Policy");
  const verificationPolicies = Object.entries(policies).filter(([name]) =>
    name.includes("VerificationRole"),
  );
  expect(verificationPolicies).toHaveLength(1);
  expect(JSON.stringify(verificationPolicies)).toContain("ssm:GetParameter");
  expect(JSON.stringify(verificationPolicies)).toContain("/TEST/*");
  expect(JSON.stringify(verificationPolicies)).not.toContain(
    "ssm:PutParameter",
  );
  expect(JSON.stringify(verificationPolicies)).not.toContain(
    "ssm:DeleteParameter",
  );
});
