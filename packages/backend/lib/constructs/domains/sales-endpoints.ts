import * as apigw from "aws-cdk-lib/aws-apigatewayv2";
import { Construct } from "constructs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as iam from "aws-cdk-lib/aws-iam";
import * as path from "path";
import { DomainConstructFactory, DomainProps } from "./domain-constructs-factory";

interface SalesDomainProps extends DomainProps {
  documentBucket: s3.IBucket;
}

export class SalesEndpoints extends DomainConstructFactory {
  constructor(scope: Construct, id: string, props: SalesDomainProps) {
    super(scope, id);

    const projectRoot = path.resolve(__dirname, "..", "..", "..");
    const map = (
      method: apigw.HttpMethod,
      routePath: string,
      area: "catalog" | "customers" | "invoices",
      handlerName: string,
      documentAccess?: "READ" | "READ_WRITE",
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
        lambdaRole: documentAccess ? undefined : props.lambdaRole,
        method,
        routePath,
        routeInDomainStack: true,
        stage: props.stage,
        table: props.table,
        ...(documentAccess
          ? {
              tableActions: documentAccess === "READ"
                ? ["dynamodb:GetItem"]
                : ["dynamodb:GetItem", "dynamodb:PutItem"],
            }
          : {}),
        ...(documentAccess
          ? { environment: { SALES_DOCUMENT_BUCKET_NAME: props.documentBucket.bucketName } }
          : {}),
      });

    const documentRoute = (
      method: apigw.HttpMethod,
      routePath: string,
      handlerName: string,
      access: "READ" | "READ_WRITE",
    ) => {
      const fn = map(method, routePath, "invoices", handlerName, access);
      fn.addToRolePolicy(new iam.PolicyStatement({
        actions: [
          "s3:GetObject",
          ...(access === "READ_WRITE" ? ["s3:PutObject"] : []),
        ],
        resources: [props.documentBucket.arnForObjects("sales/*")],
      }));
    };

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
    map(apigw.HttpMethod.POST, "/sales/invoices/{invoiceId}/issue", "invoices", "issue-sales-invoice");
    map(apigw.HttpMethod.GET, "/sales/invoices/{invoiceId}/receivable", "invoices", "get-sales-invoice-receivable");
    map(apigw.HttpMethod.GET, "/sales/invoices/{invoiceId}/payments", "invoices", "list-sales-invoice-payments");
    map(apigw.HttpMethod.POST, "/sales/invoices/{invoiceId}/payments", "invoices", "record-sales-invoice-payment");
    map(apigw.HttpMethod.POST, "/sales/invoices/{invoiceId}/credit-notes", "invoices", "create-sales-credit-note");
    map(apigw.HttpMethod.GET, "/sales/invoices/{invoiceId}/credit-notes", "invoices", "list-sales-credit-notes");
    map(apigw.HttpMethod.GET, "/sales/invoices/{invoiceId}/credit-notes/{creditNoteId}", "invoices", "get-sales-credit-note");
    map(apigw.HttpMethod.PATCH, "/sales/invoices/{invoiceId}/credit-notes/{creditNoteId}", "invoices", "update-sales-credit-note");
    map(apigw.HttpMethod.POST, "/sales/invoices/{invoiceId}/credit-notes/{creditNoteId}/lines", "invoices", "add-sales-credit-note-line");
    map(apigw.HttpMethod.PATCH, "/sales/invoices/{invoiceId}/credit-notes/{creditNoteId}/lines/{lineId}", "invoices", "update-sales-credit-note-line");
    map(apigw.HttpMethod.DELETE, "/sales/invoices/{invoiceId}/credit-notes/{creditNoteId}/lines/{lineId}", "invoices", "remove-sales-credit-note-line");
    map(apigw.HttpMethod.POST, "/sales/invoices/{invoiceId}/credit-notes/{creditNoteId}/issue", "invoices", "issue-sales-credit-note");
    map(apigw.HttpMethod.POST, "/sales/invoices/{invoiceId}/lines", "invoices", "add-sales-invoice-line");
    map(apigw.HttpMethod.PATCH, "/sales/invoices/{invoiceId}/lines/{lineId}", "invoices", "update-sales-invoice-line");
    map(apigw.HttpMethod.DELETE, "/sales/invoices/{invoiceId}/lines/{lineId}", "invoices", "remove-sales-invoice-line");
    documentRoute(
      apigw.HttpMethod.POST,
      "/sales/invoices/{invoiceId}/documents/pdf",
      "generate-sales-invoice-pdf",
      "READ_WRITE",
    );
    documentRoute(
      apigw.HttpMethod.GET,
      "/sales/invoices/{invoiceId}/documents/pdf",
      "get-sales-invoice-pdf",
      "READ",
    );
    documentRoute(
      apigw.HttpMethod.POST,
      "/sales/invoices/{invoiceId}/documents/pdf/download-url",
      "create-sales-invoice-pdf-download-url",
      "READ",
    );
    documentRoute(
      apigw.HttpMethod.POST,
      "/sales/invoices/{invoiceId}/credit-notes/{creditNoteId}/documents/pdf",
      "generate-sales-credit-note-pdf",
      "READ_WRITE",
    );
    documentRoute(
      apigw.HttpMethod.GET,
      "/sales/invoices/{invoiceId}/credit-notes/{creditNoteId}/documents/pdf",
      "get-sales-credit-note-pdf",
      "READ",
    );
    documentRoute(
      apigw.HttpMethod.POST,
      "/sales/invoices/{invoiceId}/credit-notes/{creditNoteId}/documents/pdf/download-url",
      "create-sales-credit-note-pdf-download-url",
      "READ",
    );
  }
}
