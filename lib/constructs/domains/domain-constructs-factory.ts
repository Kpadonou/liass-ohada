import * as cdk from "aws-cdk-lib";
import * as apigw from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as lambda from "aws-cdk-lib/aws-lambda-nodejs";
import { Construct } from "constructs";

export interface DomainProps {
  api: apigw.HttpApi;
  authorizer?: apigw.IHttpRouteAuthorizer;
  table: cdk.aws_dynamodb.ITable;
}

/**
 * @abstract
 * @class DomainConstructFactory
 * @extends {Construct}
 * * @description
 * Classe de base (Factory) pour la création de constructs de domaines dans l'ERP Liass-OHADA.
 * Elle centralise la logique de création de fonctions Lambda NodeJS, l'attribution des permissions
 * DynamoDB et l'enregistrement des routes sur l'API Gateway.
 * * @example
 * // Dans une sous-classe (ex: CoreLedgerEndpoints) :
 * this.addRoute(api, HttpMethod.POST, "/accounts", entryPath, table, authorizer, "CoreLedger-");
 */
export abstract class DomainConstructFactory extends Construct {
  /**
   * Crée une fonction Lambda, lui accorde les droits sur DynamoDB et l'attache à une route API.
   * * @protected
   * @param {apigw.HttpApi} api - L'API Gateway cible.
   * @param {apigw.HttpMethod} method - La méthode HTTP (GET, POST, etc.).
   * @param {string} routePath - Le chemin de la ressource API (ex: "/accounts/{id}").
   * @param {string} handlerEntry - Chemin absolu vers le fichier source .ts de la Lambda.
   * @param {cdk.aws_dynamodb.ITable} table - La table DynamoDB à injecter en variable d'environnement.
   * @param {apigw.IHttpRouteAuthorizer} [authorizer] - L'authorizer optionnel pour sécuriser la route.
   * @param {string} [idPrefix=""] - Préfixe pour l'ID unique de la Lambda (ex: "Project-") afin d'éviter les collisions CDK.
   * * @returns {void}
   */
  protected addRoute(
    api: apigw.HttpApi,
    method: apigw.HttpMethod,
    routePath: string,
    handlerEntry: string,
    table: cdk.aws_dynamodb.ITable,
    authorizer?: apigw.IHttpRouteAuthorizer,
    idPrefix?: string,
  ) {
    const handlerName =
      handlerEntry.split("/").pop()?.replace(".ts", "") || "Handler";
    const routeSuffix = `${method}-${routePath}`
      .replace(/[^A-Za-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    const id = idPrefix
      ? `${idPrefix}${handlerName}-${routeSuffix}`
      : `${handlerName}-${routeSuffix}`;

    const fn = new lambda.NodejsFunction(this, id, {
      entry: handlerEntry,
      runtime: cdk.aws_lambda.Runtime.NODEJS_20_X,
      environment: { TABLE_NAME: table.tableName },
    });

    table.grantReadWriteData(fn);

    const routeOptions: any = {
      path: routePath,
      methods: [method],
      integration: new HttpLambdaIntegration(`${id}Integ`, fn),
    };

    if (authorizer) {
      routeOptions.authorizer = authorizer;
    }

    api.addRoutes(routeOptions);
  }
}
