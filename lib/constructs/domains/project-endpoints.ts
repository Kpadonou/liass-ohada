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

export class ProjectEndpoints extends Construct {
  constructor(scope: Construct, id: string, props: DomainProps) {
    super(scope, id);

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

    const addProjectRoute = (
      method: apigw.HttpMethod,
      routePath: string,
      handlerFileName: string,
    ) => {
      const id = `Project-${handlerFileName}`;
      const entry = resolveHandlerEntry("projects", handlerFileName);
      const fn = new lambda.NodejsFunction(this, id, {
        entry,
        runtime: cdk.aws_lambda.Runtime.NODEJS_20_X,
        bundling: {
          minify: true,
          sourceMap: true,
          externalModules: ["@aws-sdk/*"],
        },
        environment: {
          TABLE_NAME: props.table.tableName,
        },
      });

      // Grant DynamoDB access
      props.table.grantReadWriteData(fn);

      const opts: any = {
        path: routePath,
        methods: [method],
        integration: new HttpLambdaIntegration(`${id}Integ`, fn),
      };
      if (props.authorizer) opts.authorizer = props.authorizer;
      props.api.addRoutes(opts);
    };

    // --- MAPPING DES ENDPOINTS (Basé sur handlers existants) ---

    // Projects
    addProjectRoute(apigw.HttpMethod.GET, "/projects", "get-projects");
    addProjectRoute(apigw.HttpMethod.POST, "/projects", "create-project");
    addProjectRoute(
      apigw.HttpMethod.GET,
      "/projects/{projectId}",
      "get-projects",
    );

    // Funding sources / donors
    addProjectRoute(
      apigw.HttpMethod.GET,
      "/projects/{projectId}/funding-sources",
      "get-donors",
    );
    addProjectRoute(
      apigw.HttpMethod.POST,
      "/projects/{projectId}/funding-sources",
      "create-donor",
    );

    // Reporting
    addProjectRoute(
      apigw.HttpMethod.GET,
      "/reports/project/{projectId}",
      "get-project-report",
    );
  }
}
