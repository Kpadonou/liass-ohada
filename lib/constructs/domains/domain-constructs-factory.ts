import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda-nodejs";
import * as apigw from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { Construct } from "constructs";
import * as path from "path";

export interface DomainProps {
  api: apigw.HttpApi;
  authorizer?: apigw.IHttpRouteAuthorizer;
  table: cdk.aws_dynamodb.ITable;
}

export abstract class DomainConstructFactory extends Construct {
  protected addRoute(
    api: apigw.HttpApi,
    method: apigw.HttpMethod,
    routePath: string,
    handlerEntry: string,
    table: cdk.aws_dynamodb.ITable,
    authorizer?: apigw.IHttpRouteAuthorizer,
    idPrefix?: string,
  ) {
    const handlerName = handlerEntry.split("/").pop()?.replace(".ts", "") || "Handler";
    const id = idPrefix ? `${idPrefix}${handlerName}` : handlerName;

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
