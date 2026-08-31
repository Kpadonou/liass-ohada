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
      area: "catalog" | "customers" | "invoices",
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
          area,
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

    map(apigw.HttpMethod.POST, "/sales/customers", "customers", "create-sales-customer");
    map(apigw.HttpMethod.GET, "/sales/customers", "customers", "list-sales-customers");
    map(apigw.HttpMethod.GET, "/sales/customers/{customerId}", "customers", "get-sales-customer");
    map(apigw.HttpMethod.PATCH, "/sales/customers/{customerId}", "customers", "update-sales-customer");
    map(apigw.HttpMethod.POST, "/sales/customers/{customerId}/activate", "customers", "activate-sales-customer");
    map(apigw.HttpMethod.POST, "/sales/customers/{customerId}/deactivate", "customers", "deactivate-sales-customer");

    map(apigw.HttpMethod.POST, "/sales/items", "catalog", "create-sales-catalog-item");
    map(apigw.HttpMethod.GET, "/sales/items", "catalog", "list-sales-catalog-items");
    map(apigw.HttpMethod.GET, "/sales/items/{itemId}", "catalog", "get-sales-catalog-item");
    map(apigw.HttpMethod.PATCH, "/sales/items/{itemId}", "catalog", "update-sales-catalog-item");
    map(apigw.HttpMethod.POST, "/sales/items/{itemId}/activate", "catalog", "activate-sales-catalog-item");
    map(apigw.HttpMethod.POST, "/sales/items/{itemId}/deactivate", "catalog", "deactivate-sales-catalog-item");

    map(apigw.HttpMethod.POST, "/sales/invoices", "invoices", "create-sales-invoice");
    map(apigw.HttpMethod.GET, "/sales/invoices", "invoices", "list-sales-invoices");
    map(apigw.HttpMethod.GET, "/sales/invoices/{invoiceId}", "invoices", "get-sales-invoice");
    map(apigw.HttpMethod.PATCH, "/sales/invoices/{invoiceId}", "invoices", "update-sales-invoice");
    map(apigw.HttpMethod.POST, "/sales/invoices/{invoiceId}/lines", "invoices", "add-sales-invoice-line");
    map(apigw.HttpMethod.PATCH, "/sales/invoices/{invoiceId}/lines/{lineId}", "invoices", "update-sales-invoice-line");
    map(apigw.HttpMethod.DELETE, "/sales/invoices/{invoiceId}/lines/{lineId}", "invoices", "remove-sales-invoice-line");
  }
}
