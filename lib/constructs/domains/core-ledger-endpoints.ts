import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda-nodejs";
import * as apigw from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { Construct } from "constructs";
import * as path from "path";
import * as fs from "fs";

export interface DomainProps {
  api: apigw.HttpApi;
  authorizer?: apigw.IHttpRouteAuthorizer;
  table: cdk.aws_dynamodb.ITable;
}

export class CoreLedgerEndpoints extends Construct {
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
      if (fs.existsSync(srcPath)) return srcPath;
      return legacyPath;
    };

    const addRoute = (
      method: apigw.HttpMethod,
      routePath: string,
      handlerPath: string,
    ) => {
      const id = `Core-${handlerPath.replace(/\//g, "-")}`;
      const entry = resolveHandlerEntry("core-ledger", handlerPath);
      const fn = new lambda.NodejsFunction(this, id, {
        entry,
        runtime: cdk.aws_lambda.Runtime.NODEJS_20_X,
        bundling: {
          minify: true,
          sourceMap: true,
          externalModules: ["@aws-sdk/*"],
        },
        environment: { TABLE_NAME: props.table.tableName },
      });

      // grant table access
      props.table.grantReadWriteData(fn);

      const routeOptions: any = {
        path: routePath,
        methods: [method],
        integration: new HttpLambdaIntegration(`${id}Integ`, fn),
      };
      if (props.authorizer) routeOptions.authorizer = props.authorizer;
      props.api.addRoutes(routeOptions);
    };

    // --- Core Ledger Endpoints ---
    // Accounts
    addRoute(apigw.HttpMethod.POST, "/accounts", "accounts/create-account");
    addRoute(
      apigw.HttpMethod.GET,
      "/accounts/{accountId}",
      "accounts/get-account",
    );
    addRoute(
      apigw.HttpMethod.GET,
      "/accounts/{accountId}/balance",
      "accounts/get-balance",
    );
    addRoute(
      apigw.HttpMethod.GET,
      "/accounts/{accountId}/entries",
      "accounts/get-entries",
    );

    // Entries
    addRoute(apigw.HttpMethod.POST, "/entries", "entries/post-entry");

    // Books
    addRoute(
      apigw.HttpMethod.GET,
      "/books/general-ledger",
      "books/get-general-ledger",
    );
    addRoute(
      apigw.HttpMethod.GET,
      "/books/trial-balance",
      "books/get-trial-balance",
    );
    addRoute(
      apigw.HttpMethod.GET,
      "/books/third-party-ledger",
      "books/get-third-party-ledger",
    );
    addRoute(
      apigw.HttpMethod.GET,
      "/books/matching-report",
      "books/get-matching-report",
    );

    // Fiscal Year
    addRoute(
      apigw.HttpMethod.GET,
      "/fiscal-year/{year}",
      "fiscal-year/get-details",
    );
    addRoute(
      apigw.HttpMethod.POST,
      "/fiscal-year/{year}/close",
      "fiscal-year/close-year",
    );
    addRoute(
      apigw.HttpMethod.POST,
      "/fiscal-year/{year}/lock",
      "fiscal-year/lock-period",
    );
    addRoute(
      apigw.HttpMethod.POST,
      "/fiscal-year/{year}/unlock",
      "fiscal-year/unlock-period",
    );

    // Lettering
    addRoute(apigw.HttpMethod.POST, "/lettering", "lettering/post-lettering");
    addRoute(
      apigw.HttpMethod.POST,
      "/lettering/cancel",
      "lettering/cancel-lettering",
    );
    addRoute(
      apigw.HttpMethod.GET,
      "/lettering/unlettered",
      "lettering/get-unlettered-lines",
    );
  }
}
