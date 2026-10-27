import { Construct } from "constructs";
import { Duration } from "aws-cdk-lib";
import * as apigw from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import * as iam from "aws-cdk-lib/aws-iam";
import { ITable } from "aws-cdk-lib/aws-dynamodb";
import * as path from "path";
import { DomainProps } from "./domain-constructs-factory";
import { RESTAURANTS_ROUTES } from "../../../lambda/domains/restaurants/restaurant-routes";
import {
  INVENTORY_GATEWAY_PATH,
  INVENTORY_GATEWAY_METHODS,
} from "../../../lambda/domains/restaurants/inventory-routes";

/** Same reviewed bounded-invocation pattern as GuestRouteIntegration. */
class ManagementIntegration extends HttpLambdaIntegration {
  protected override completeBind(): void {}
}

/** Called at the original factory scope to preserve the get-outlet Lambda identity. */
export function addRestaurantsManagementRoutes(
  scope: Construct,
  props: DomainProps & { restaurantsTable: ITable; lambdaRole: iam.IRole },
) {
  const id = "Restaurants-get-outlet-GET-restaurants-outlets-outletId";
  const functionName = `liass-ohada-${props.stage}-restaurants-get-outlet`;
  const fn = new NodejsFunction(scope, id, {
    entry: path.join(
      __dirname,
      "../../../lambda/domains/restaurants/get-outlet.ts",
    ),
    functionName,
    role: props.lambdaRole,
    runtime: Runtime.NODEJS_24_X,
    timeout: Duration.seconds(30),
    memorySize: 512,
    logGroup: logs.LogGroup.fromLogGroupName(
      scope,
      `${id}ExistingLogGroup`,
      `/aws/lambda/${functionName}`,
    ),
    bundling: { bundleAwsSDK: true },
    environment: {
      TABLE_NAME: props.table.tableName,
      PLATFORM_TABLE_NAME: props.table.tableName,
      RESTAURANTS_TABLE_NAME: props.restaurantsTable.tableName,
    },
  });
  const integration = new ManagementIntegration(`${id}Integ`, fn);
  const stage = props.api.defaultStage?.stageName;
  if (!stage)
    throw new Error("Restaurants management requires an explicit API stage");
  const outlets = RESTAURANTS_ROUTES.filter((r) => r.kind === "outlet");
  // Bind the historical GET first: its existing Integration logical identity is retained.
  for (const route of outlets) {
    const routeId = `Restaurants-${route.name}-${route.method}-${route.path}`
      .replace(/[^A-Za-z0-9]+/g, "-")
      .replace(/-$/g, "");
    new apigw.HttpRoute(scope, `${routeId}Route`, {
      httpApi: props.api,
      authorizer: props.authorizer,
      integration,
      routeKey: apigw.HttpRouteKey.with(
        route.path,
        apigw.HttpMethod[route.method],
      ),
    });
  }
  // ANY captures anonymous preflight before the shared CORS responder.
  // Five method groups replace two ANY + three tracking routes at zero net cost.
  for (const method of INVENTORY_GATEWAY_METHODS)
    new apigw.HttpRoute(scope, `Inventory${method}RouteGroup`, {
      httpApi: props.api,
      authorizer: props.authorizer,
      integration,
      routeKey: apigw.HttpRouteKey.with(
        INVENTORY_GATEWAY_PATH,
        apigw.HttpMethod[method],
      ),
    });
  for (const route of outlets)
    fn.addPermission(`Outlet-${route.name}-Invoke`, {
      principal: new iam.ServicePrincipal("apigateway.amazonaws.com"),
      sourceAccount: fn.stack.account,
      sourceArn: props.api.arnForExecuteApi(
        route.method,
        route.path.replace(/\{\w+\}/g, "*"),
        stage,
      ),
    });
  for (const [name, inventoryPath] of [
    ["InventoryCollectionInvoke", "/restaurants/outlets/*/inventory/items"],
    ["InventoryMemberInvoke", "/restaurants/outlets/*/inventory/items/*"],
    [
      "InventoryTrackingInvoke",
      "/restaurants/outlets/*/inventory/menu-items/*/tracking",
    ],
  ])
    fn.addPermission(name, {
      principal: new iam.ServicePrincipal("apigateway.amazonaws.com"),
      sourceAccount: fn.stack.account,
      sourceArn: props.api.arnForExecuteApi("*", inventoryPath, stage),
    });
}
