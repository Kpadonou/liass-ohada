import * as apigw from "aws-cdk-lib/aws-apigatewayv2";
import { Construct } from "constructs";
import * as path from "path";
import * as fs from "fs";
import { DomainConstructFactory } from "./domain-constructs-factory";

export interface DomainProps {
  api: apigw.HttpApi;
  authorizer?: apigw.IHttpRouteAuthorizer;
  table: any;
}

export class ProjectEndpoints extends DomainConstructFactory {
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
      const entry = resolveHandlerEntry("projects", handlerPath);
      this.addRoute(
        props.api,
        method,
        routePath,
        entry,
        props.table,
        props.authorizer,
        "Project-",
      );
    };

    // --- Project Domain Endpoints ---
    // Projects
    map(apigw.HttpMethod.POST, "/projects", "create-project");
    map(apigw.HttpMethod.GET, "/projects", "get-projects");
    map(apigw.HttpMethod.GET, "/projects/{projectId}", "get-projects");

    // Donors (at project level)
    map(
      apigw.HttpMethod.POST,
      "/projects/{projectId}/funding-sources",
      "create-donor",
    );
    map(
      apigw.HttpMethod.GET,
      "/projects/{projectId}/funding-sources",
      "get-donors",
    );

    // Reporting
    map(
      apigw.HttpMethod.GET,
      "/projects/{projectId}/report",
      "get-project-report",
    );

    // Dashboard
    map(
      apigw.HttpMethod.GET,
      "/projects/summary",
      "list-projects-summary",
    );
  }
}
