import { Construct } from "constructs";
import { Duration, RemovalPolicy } from "aws-cdk-lib";
import * as api from "aws-cdk-lib/aws-apigatewayv2";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import * as secrets from "aws-cdk-lib/aws-secretsmanager";
import { ITable } from "aws-cdk-lib/aws-dynamodb";
import * as path from "path";
import { DomainProps } from "./domain-constructs-factory";

/** CDK's default completeBind adds one permission per route. Keep the reused
 * integration, but grant only the reviewed API/stage/path families below.
 * scopePermissionToRoute:false would instead grant API-wide invocation.
 */
class GuestRouteIntegration extends HttpLambdaIntegration {
  protected override completeBind(): void {
    // Invocation is granted explicitly by RestaurantsGuestEndpoints.
  }
}

/** Two grouped entry points; staff/default authorizer remains untouched. */
export class RestaurantsGuestEndpoints extends Construct {
  readonly publicIntegration: HttpLambdaIntegration;
  readonly staffIntegration: HttpLambdaIntegration;
  constructor(
    scope: Construct,
    id: string,
    props: DomainProps & { restaurantsTable: ITable; staffRole: iam.IRole },
  ) {
    super(scope, id);
    const secret = new secrets.Secret(this, "CapabilitySecret", {
      secretName: `liass-ohada-${props.stage}-restaurants-guest-capability`,
      generateSecretString: {
        secretStringTemplate: "{}",
        generateStringKey: "key",
        passwordLength: 64,
        excludePunctuation: true,
      },
      removalPolicy: RemovalPolicy.RETAIN,
    });
    const role = new iam.Role(this, "PublicRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AWSLambdaBasicExecutionRole",
        ),
      ],
      // Embedded policy avoids a separate AWS::IAM::Policy resource.
      inlinePolicies: {
        GuestRead: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              actions: ["dynamodb:GetItem"],
              resources: [
                props.restaurantsTable.tableArn,
                props.table.tableArn,
              ],
            }),
            new iam.PolicyStatement({
              actions: [
                "secretsmanager:GetSecretValue",
                "secretsmanager:DescribeSecret",
              ],
              resources: [secret.secretArn],
            }),
          ],
        }),
      },
    });
    const fn = (
      name: string,
      entry: string,
      executionRole: iam.IRole,
      publicGuest = false,
    ) => {
      const functionName = `liass-ohada-${props.stage}-restaurants-${name}`;
      return new NodejsFunction(this, name, {
        functionName,
        entry: path.join(
          __dirname,
          "../../../lambda/domains/restaurants",
          `${entry}.ts`,
        ),
        runtime: lambda.Runtime.NODEJS_24_X,
        role: executionRole,
        timeout: Duration.seconds(15),
        memorySize: 256,
        logGroup: logs.LogGroup.fromLogGroupName(
          this,
          `${name}Logs`,
          `/aws/lambda/${functionName}`,
        ),
        bundling: { bundleAwsSDK: true },
        environment: {
          STAGE: props.stage,
          PLATFORM_TABLE_NAME: props.table.tableName,
          TABLE_NAME: props.table.tableName,
          RESTAURANTS_TABLE_NAME: props.restaurantsTable.tableName,
          ...(publicGuest
            ? { RESTAURANTS_GUEST_SECRET_ARN: secret.secretArn }
            : {}),
        },
      });
    };
    const publicFn = fn("guest-public", "guest-public", role, true);
    const staffFn = fn("guest-qr-staff", "guest-qr-staff", props.staffRole);
    const publicIntegration = (this.publicIntegration =
      new GuestRouteIntegration("PublicIntegration", publicFn));
    const staffIntegration = (this.staffIntegration = new GuestRouteIntegration(
      "StaffIntegration",
      staffFn,
    ));
    const stageName = props.api.defaultStage?.stageName;
    if (!stageName)
      throw new Error("Guest invocation requires an explicit API stage");
    for (const [target, id, routePath] of [
      [publicFn, "PublicGuestInvoke", "/public/restaurants/guest/*"],
      [
        staffFn,
        "StaffQrInvoke",
        "/restaurants/outlets/*/service-areas/*/tables/*/qr/*",
      ],
    ] as const) {
      target.addPermission(id, {
        principal: new iam.ServicePrincipal("apigateway.amazonaws.com"),
        sourceAccount: target.stack.account,
        sourceArn: props.api.arnForExecuteApi("*", routePath, stageName),
      });
    }
    for (const operation of ["resolve", "renew"])
      new api.HttpRoute(this, `Public-${operation}`, {
        httpApi: props.api,
        routeKey: api.HttpRouteKey.with(
          `/public/restaurants/guest/${operation}`,
          api.HttpMethod.POST,
        ),
        authorizer: new api.HttpNoneAuthorizer(),
        integration: publicIntegration,
      });
    const base =
      "/restaurants/outlets/{outletId}/service-areas/{areaId}/tables/{tableId}/qr";
    for (const operation of ["rotate", "revoke", "status"])
      new api.HttpRoute(this, `Staff-${operation}`, {
        httpApi: props.api,
        routeKey: api.HttpRouteKey.with(
          `${base}/${operation}`,
          operation === "status" ? api.HttpMethod.GET : api.HttpMethod.POST,
        ),
        authorizer: props.authorizer,
        integration: staffIntegration,
      });
    const stage = props.api.defaultStage?.node.defaultChild;
    if (stage instanceof api.CfnStage) {
      stage.routeSettings = {
        ...(stage.routeSettings as Record<
          string,
          api.CfnStage.RouteSettingsProperty
        >),
        ...Object.fromEntries(
          ["resolve", "renew"].map((op) => [
            `POST /public/restaurants/guest/${op}`,
            { throttlingBurstLimit: 20, throttlingRateLimit: 10 },
          ]),
        ),
      };
    }
  }
}
