import * as apigw from "aws-cdk-lib/aws-apigatewayv2";
import { Construct } from "constructs";
import * as path from "path";
import {
  DomainConstructFactory,
  DomainProps,
} from "./domain-constructs-factory";
import { RESTAURANTS_ROUTES } from "../../../lambda/domains/restaurants/restaurant-routes";

export class RestaurantsEndpoints extends DomainConstructFactory {
  constructor(scope: Construct, id: string, props: DomainProps) {
    super(scope, id);
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
        lambdaRole: props.lambdaRole,
        method: apigw.HttpMethod[route.method],
        routePath: route.path,
        routeInDomainStack: true,
        stage: props.stage,
        table: props.table,
      });
    }
  }
}
