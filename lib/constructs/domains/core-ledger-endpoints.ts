import * as lambda from "aws-cdk-lib/aws-lambda-nodejs";
import * as apigw from "aws-apigatewayv2-alpha";
import { HttpLambdaIntegration } from "aws-apigatewayv2-integrations-alpha";
import { Construct } from "constructs";
import * as path from "path";

export interface DomainProps {
  api: apigw.HttpApi;
  authorizer: apigw.IHttpRouteAuthorizer;
  table: any; // Ta table DynamoDB
}

export class CoreLedgerDomain extends Construct {
  constructor(scope: Construct, id: string, props: DomainProps) {
    super(scope, id);

    // Fonction utilitaire pour éviter la répétition
    const addRoute = (
      method: apigw.HttpMethod,
      routePath: string,
      handlerPath: string,
    ) => {
      const fn = new lambda.NodejsFunction(
        this,
        handlerPath.replace(/\//g, "-"),
        {
          entry: path.join(
            __dirname,
            `../../../lambda/domains/core-ledger/${handlerPath}.ts`,
          ),
          environment: { TABLE_NAME: props.table.tableName },
        },
      );

      props.api.addRoutes({
        path: routePath,
        methods: [method],
        integration: new HttpLambdaIntegration(`${handlerPath}Integ`, fn),
        authorizer: props.authorizer,
      });
    };

    // --- COPILLOT PEUT GÉNÉRER TOUT ÇA ---
    addRoute(apigw.HttpMethod.POST, "/entries", "entries/post-entry");
    addRoute(apigw.HttpMethod.GET, "/accounts", "accounts/get-account");
    addRoute(
      apigw.HttpMethod.GET,
      "/books/trial-balance",
      "books/get-trial-balance",
    );
    // ... tu peux en ajouter 50 ici, ça reste lisible.
  }
}
