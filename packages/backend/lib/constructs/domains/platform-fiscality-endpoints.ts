import { HttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";
import { Duration, Stack } from "aws-cdk-lib";
import * as path from "node:path";
import { DomainConstructFactory, DomainProps } from "./domain-constructs-factory";

/** Platform-owned APIs belong to IdentityApiStack; registry writes are IAM-only operations. */
export class PlatformFiscalityEndpoints extends DomainConstructFactory {
  constructor(scope: Construct, id: string, props: DomainProps & { cognitoIssuer: string }) {
    super(scope, id);
    const role = new iam.Role(this, "SfeReferenceRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole")],
    });
    role.addToPolicy(new iam.PolicyStatement({
      actions: ["dynamodb:GetItem"], resources: [props.table.tableArn],
    }));
    // TransactWriteItems is authorized by the constituent PutItem/ConditionCheckItem operations.
    role.addToPolicy(new iam.PolicyStatement({
      actions: ["dynamodb:PutItem"], resources: [props.table.tableArn],
      conditions: { "ForAllValues:StringEquals": { "dynamodb:LeadingKeys": [`PLATFORM_SFE#${props.stage}#BJ`] } },
    }));
    role.addToPolicy(new iam.PolicyStatement({
      actions: ["dynamodb:ConditionCheckItem"], resources: [props.table.tableArn],
      conditions: { "ForAllValues:StringLike": { "dynamodb:LeadingKeys": [`PLATFORM_ADMIN#${props.stage}#*`] } },
    }));
    role.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.DENY,
      actions: ["dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem", "dynamodb:BatchWriteItem"],
      resources: [props.table.tableArn],
      conditions: { "ForAnyValue:StringLike": { "dynamodb:LeadingKeys": ["PLATFORM_ADMIN#*"] } },
    }));
    for (const [method, routePath, actionName] of [
      [HttpMethod.GET, "/me/organization/fiscality/sfe-approval", "read-sfe-approval"],
      [HttpMethod.PUT, "/platform/fiscality/sfe-approval", "update-sfe-approval"],
    ] as const) {
      this.addRoute({ ...props, lambdaRole: role, method, routePath, actionName,
        domainName: "identity", routeInDomainStack: true,
        environment: { STAGE: props.stage, PLATFORM_COGNITO_ISSUER: props.cognitoIssuer },
        handlerEntry: path.join(__dirname, "../../../lambda/domains/identity/platform-sfe-handler.ts"),
      });
    }
    const enrollmentRole = new iam.Role(this, "EnrollmentRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole")],
    });
    enrollmentRole.addToPolicy(new iam.PolicyStatement({
      actions: ["dynamodb:GetItem", "dynamodb:Query", "dynamodb:PutItem", "dynamodb:ConditionCheckItem"],
      resources: [props.table.tableArn],
      conditions: { "ForAllValues:StringLike": { "dynamodb:LeadingKeys": ["ORG#*"] } },
    }));
    const parameterArn = Stack.of(this).formatArn({ service: "ssm", resource: "parameter", resourceName: `${props.stage}/platform/fiscal/*` });
    enrollmentRole.addToPolicy(new iam.PolicyStatement({
      actions: ["ssm:PutParameter"], resources: [parameterArn], conditions: { StringEquals: { "ssm:Overwrite": "false" } },
    }));
    enrollmentRole.addToPolicy(new iam.PolicyStatement({ actions: ["ssm:GetParameter"], resources: [parameterArn] }));
    const verificationRole = new iam.Role(this, "VerificationRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole")],
    });
    verificationRole.addToPolicy(new iam.PolicyStatement({
      actions: ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:ConditionCheckItem"], resources: [props.table.tableArn],
      conditions: { "ForAllValues:StringLike": { "dynamodb:LeadingKeys": ["ORG#*"] } },
    }));
    verificationRole.addToPolicy(new iam.PolicyStatement({
      actions: ["dynamodb:GetItem"], resources: [props.table.tableArn],
      conditions: { "ForAllValues:StringEquals": { "dynamodb:LeadingKeys": [`PLATFORM_SFE#${props.stage}#BJ`] } },
    }));
    const verificationParameterArn = Stack.of(this).formatArn({ service: "ssm", resource: "parameter", resourceName: `${props.stage}/platform/fiscal/*/TEST/*` });
    verificationRole.addToPolicy(new iam.PolicyStatement({ actions: ["ssm:GetParameter"], resources: [verificationParameterArn] }));
    // No GetParametersByPath, DeleteParameter, SecretsManager, custom KMS key or administrator-registry access.
    for (const [method, routePath, actionName] of [
      [HttpMethod.GET, "/me/organization/fiscality/connections", "list-fiscal-connections"],
      [HttpMethod.PUT, "/me/organization/fiscality/connections/{connectionId}", "configure-fiscal-connection"],
      [HttpMethod.PUT, "/me/organization/fiscality/connections/{connectionId}/credential", "store-fiscal-credential"],
      [HttpMethod.DELETE, "/me/organization/fiscality/connections/{connectionId}/credential", "revoke-fiscal-credential"],
      [HttpMethod.POST, "/me/organization/fiscality/connections/{connectionId}/verification", "verify-fiscal-connection"],
    ] as const) {
      const verification = actionName === "verify-fiscal-connection";
      this.addRoute({ ...props, lambdaRole: verification ? verificationRole : enrollmentRole, method, routePath, actionName,
        ...(verification ? { timeout: Duration.seconds(30) } : {}),
        domainName: "identity", routeInDomainStack: true,
        environment: { STAGE: props.stage, PLATFORM_COGNITO_ISSUER: props.cognitoIssuer,
          ...(verification ? { FISCAL_CREDENTIAL_TEST_VERIFICATION_ENABLED: "0" } : {}) },
        handlerEntry: path.join(__dirname, "../../../lambda/domains/identity/organization-fiscal-handler.ts"),
      });
    }
  }
}
