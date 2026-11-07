import { HttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";
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
  }
}
