import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda-nodejs";
import * as apigw from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { Construct } from "constructs";
import * as path from "path";
import * as fs from "fs";
import { DomainConstructFactory } from "./domain-constructs-factory";

export interface DomainProps {
  api: apigw.HttpApi;
  authorizer?: apigw.IHttpRouteAuthorizer;
  table: cdk.aws_dynamodb.ITable;
}

export class CoreLedgerEndpoints extends DomainConstructFactory {
  constructor(scope: Construct, id: string, props: DomainProps) {
    super(scope, id);

    // helper: resolve path to handler, prefer src/ layout then fallback to lambda/
    const resolveHandlerEntry = (domain: string, handlerPath: string) => {
      const srcPath = path.join(
        __dirname,
        "..",
        "..",
        "..",
        "src",
        "lambda",
        "domains",
        domain,
        `${handlerPath}.ts`,
      );
      const legacyPath = path.join(
        __dirname,
        "..",
        "..",
        "..",
        "lambda",
        "domains",
        domain,
        `${handlerPath}.ts`,
      );
      return fs.existsSync(srcPath) ? srcPath : legacyPath;
    };

    const map = (
      method: apigw.HttpMethod,
      routePath: string,
      handlerPath: string,
    ) => {
      const entry = resolveHandlerEntry("core-ledger", handlerPath);
      this.addRoute(
        props.api,
        method,
        routePath,
        entry,
        props.table,
        props.authorizer,
        "CoreLedger-",
      );
    };

    // --- Core Ledger Endpoints ---
    // Accounts
    map(apigw.HttpMethod.POST, "/accounts", "accounts/create-account");
    map(apigw.HttpMethod.GET, "/accounts/{accountId}", "accounts/get-account");
    map(
      apigw.HttpMethod.GET,
      "/accounts/{accountId}/balance",
      "accounts/get-balance",
    );
    map(
      apigw.HttpMethod.GET,
      "/accounts/{accountId}/entries",
      "accounts/get-entries",
    );

    // Entries
    map(apigw.HttpMethod.POST, "/entries", "entries/post-entry");

    // Books
    map(
      apigw.HttpMethod.GET,
      "/books/general-ledger",
      "books/get-general-ledger",
    );
    map(
      apigw.HttpMethod.GET,
      "/books/trial-balance",
      "books/get-trial-balance",
    );
    map(
      apigw.HttpMethod.GET,
      "/books/third-party-ledger",
      "books/get-third-party-ledger",
    );
    map(
      apigw.HttpMethod.GET,
      "/books/matching-report",
      "books/get-matching-report",
    );

    // Fiscal Year
    map(apigw.HttpMethod.GET, "/fiscal-year/{year}", "fiscal-year/get-details");
    map(
      apigw.HttpMethod.POST,
      "/fiscal-year/{year}/close",
      "fiscal-year/close-year",
    );
    map(
      apigw.HttpMethod.POST,
      "/fiscal-year/{year}/lock",
      "fiscal-year/lock-period",
    );
    map(
      apigw.HttpMethod.POST,
      "/fiscal-year/{year}/unlock",
      "fiscal-year/unlock-period",
    );

    // Lettering
    map(apigw.HttpMethod.POST, "/lettering", "lettering/post-lettering");
    map(
      apigw.HttpMethod.POST,
      "/lettering/cancel",
      "lettering/cancel-lettering",
    );
    map(
      apigw.HttpMethod.GET,
      "/lettering/unlettered",
      "lettering/get-unlettered-lines",
    );

    // Journals
    map(apigw.HttpMethod.POST, "/journals", "journals/create-journal");
    map(apigw.HttpMethod.GET, "/journals", "journals/list-journals");
    map(
      apigw.HttpMethod.GET,
      "/journals/{journalCode}",
      "journals/get-journal",
    );
    map(
      apigw.HttpMethod.PUT,
      "/journals/{journalCode}",
      "journals/update-journal",
    );
    map(
      apigw.HttpMethod.DELETE,
      "/journals/{journalCode}",
      "journals/delete-journal",
    );
  }
}
