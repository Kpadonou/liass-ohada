import * as apigw from "aws-cdk-lib/aws-apigatewayv2";
import { Construct } from "constructs";
import * as path from "path";
import { DomainConstructFactory, DomainProps } from "./domain-constructs-factory";

export class SalesEndpoints extends DomainConstructFactory {
  constructor(scope: Construct, id: string, props: DomainProps) {
    super(scope, id);

    const projectRoot = path.resolve(__dirname, "..", "..", "..");
    const map = (
      method: apigw.HttpMethod,
      routePath: string,
      handlerName: string,
    ) =>
      this.addRoute({
        api: props.api,
        authorizer: props.authorizer,
        domainName: "sales",
        handlerEntry: path.join(
          projectRoot,
          "lambda",
          "domains",
          "sales",
          "customers",
          `${handlerName}.ts`,
        ),
        idPrefix: "Sales-",
        lambdaRole: props.lambdaRole,
        method,
        routePath,
        routeInDomainStack: true,
        stage: props.stage,
        table: props.table,
      });

    map(apigw.HttpMethod.POST, "/sales/customers", "create-sales-customer");
    map(apigw.HttpMethod.GET, "/sales/customers", "list-sales-customers");
    map(apigw.HttpMethod.GET, "/sales/customers/{customerId}", "get-sales-customer");
    map(apigw.HttpMethod.PATCH, "/sales/customers/{customerId}", "update-sales-customer");
    map(apigw.HttpMethod.POST, "/sales/customers/{customerId}/activate", "activate-sales-customer");
    map(apigw.HttpMethod.POST, "/sales/customers/{customerId}/deactivate", "deactivate-sales-customer");
  }
}
