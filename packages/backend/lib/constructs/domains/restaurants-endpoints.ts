import * as apigw from "aws-cdk-lib/aws-apigatewayv2";
import { Construct } from "constructs";
import * as path from "path";
import {
  DomainConstructFactory,
  DomainProps,
} from "./domain-constructs-factory";
import { RESTAURANTS_ROUTES } from "../../../lambda/domains/restaurants/restaurant-routes";

import * as iam from "aws-cdk-lib/aws-iam";
import { ITable } from "aws-cdk-lib/aws-dynamodb";

export class RestaurantsEndpoints extends DomainConstructFactory {
  constructor(
    scope: Construct,
    id: string,
    props: Omit<DomainProps, "lambdaRole"> & { restaurantsTable: ITable },
  ) {
    super(scope, id);
    const role = new iam.Role(this, "ExecutionRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AWSLambdaBasicExecutionRole",
        ),
      ],
    });
    // Direct membership/product reads and reachable cabinet snapshot BatchGet. No Query/Scan needed for Platform.
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["dynamodb:GetItem", "dynamodb:BatchGetItem"],
        resources: [props.table.tableArn],
      }),
    );
    // Transaction authorization uses the underlying Put/Delete/ConditionCheckItem actions.
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          "dynamodb:GetItem",
          "dynamodb:Query",
          "dynamodb:PutItem",
          "dynamodb:DeleteItem",
          "dynamodb:ConditionCheckItem",
        ],
        resources: [props.restaurantsTable.tableArn],
      }),
    );
    const projectRoot = path.resolve(__dirname, "..", "..", "..");
    for (const route of RESTAURANTS_ROUTES) {
      this.addRoute({
        api: props.api,
        authorizer: props.authorizer,
        domainName: "restaurants",
        handlerEntry: path.join(
          projectRoot,
          "lambda",
          "domains",
          "restaurants",
          `${route.name}.ts`,
        ),
        idPrefix: "Restaurants-",
        lambdaRole: role,
        environment: {
          PLATFORM_TABLE_NAME: props.table.tableName,
          RESTAURANTS_TABLE_NAME: props.restaurantsTable.tableName,
        },
        method: apigw.HttpMethod[route.method],
        routePath: route.path,
        routeInDomainStack: true,
        stage: props.stage,
        table: props.table,
      });
    }
  }
}
