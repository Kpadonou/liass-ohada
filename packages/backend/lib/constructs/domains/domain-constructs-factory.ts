import * as cdk from "aws-cdk-lib";
import * as apigw from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as iam from "aws-cdk-lib/aws-iam";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import * as lambda from "aws-cdk-lib/aws-lambda-nodejs";
import { Construct } from "constructs";
import * as path from "path";
import { DeploymentStage } from "../../config/deployment";

const DOMAIN_LAMBDA_RUNTIME = Runtime.NODEJS_24_X;

export interface DomainProps {
  api: apigw.HttpApi;
  authorizer?: apigw.IHttpRouteAuthorizer;
  lambdaRole?: iam.IRole;
  stage: DeploymentStage;
  table: cdk.aws_dynamodb.ITable;
}

interface AddRouteOptions {
  actionName?: string;
  api: apigw.HttpApi;
  authorizer?: apigw.IHttpRouteAuthorizer;
  constructIdOverride?: string;
  domainName: string;
  handlerEntry: string;
  idPrefix?: string;
  lambdaRole?: iam.IRole;
  memorySize?: number;
  method: apigw.HttpMethod;
  routePath: string;
  stage: DeploymentStage;
  table: cdk.aws_dynamodb.ITable;
  timeout?: cdk.Duration;
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
 * // Dans une sous-classe (ex: AccountingEndpoints) :
 * this.addRoute({ api, method: HttpMethod.POST, routePath: "/accounts", handlerEntry, table, stage });
 */
export abstract class DomainConstructFactory extends Construct {
  private static sanitizeNamePart(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  }

  private static buildFunctionName(
    stage: DeploymentStage,
    domainName: string,
    actionName: string,
  ): string {
    const name = [
      "liass-ohada",
      stage,
      DomainConstructFactory.sanitizeNamePart(domainName),
      DomainConstructFactory.sanitizeNamePart(actionName),
    ].join("-");

    return name.slice(0, 64).replace(/-$/g, "");
  }

  /**
   * Crée une fonction Lambda, lui accorde les droits sur DynamoDB et l'attache à une route API.
   *
   * The construct ID remains route-specific to avoid CDK collisions, while
   * functionName controls the readable physical name shown in AWS.
   * * @returns {void}
   */
  protected addRoute(options: AddRouteOptions) {
    const handlerName = path.basename(options.handlerEntry, ".ts");
    const actionName = options.actionName ?? handlerName;
    const routeSuffix = `${options.method}-${options.routePath}`
      .replace(/[^A-Za-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    const generatedId = options.idPrefix
      ? `${options.idPrefix}${handlerName}-${routeSuffix}`
      : `${handlerName}-${routeSuffix}`;
    const id = options.constructIdOverride ?? generatedId;
    const functionName = DomainConstructFactory.buildFunctionName(
      options.stage,
      options.domainName,
      actionName,
    );

    const fn = new lambda.NodejsFunction(this, id, {
      entry: options.handlerEntry,
      functionName,
      role: options.lambdaRole,
      runtime: DOMAIN_LAMBDA_RUNTIME,
      memorySize: options.memorySize,
      timeout: options.timeout,
      bundling: {
        // Node.js 24 does not guarantee that transitive AWS SDK v3/Smithy modules
        // are available in the managed runtime. Keep domain Lambdas self-contained.
        bundleAwsSDK: true,
      },
      environment: { TABLE_NAME: options.table.tableName },
    });

    if (!options.lambdaRole) {
      options.table.grantReadWriteData(fn);
    }

    const routeOptions: any = {
      path: options.routePath,
      methods: [options.method],
      integration: new HttpLambdaIntegration(`${id}Integ`, fn),
    };

    if (options.authorizer) {
      routeOptions.authorizer = options.authorizer;
    }

    options.api.addRoutes(routeOptions);
  }
}
