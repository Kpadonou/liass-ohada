import * as apigw from "aws-cdk-lib/aws-apigatewayv2";
import { Construct } from "constructs";
import * as path from "path";
import { DomainConstructFactory } from "./domain-constructs-factory";

export interface DomainProps {
  api: apigw.HttpApi;
  authorizer?: apigw.IHttpRouteAuthorizer;
  table: any;
}

export class ProjectEndpoints extends DomainConstructFactory {
  constructor(scope: Construct, id: string, props: DomainProps) {
    super(scope, id);

    // Resolve project root from current directory
    const projectRoot = path.resolve(__dirname, "..", "..", "..");

    // helper: resolve path to handler using absolute path from project root
    const resolveHandlerEntry = (domain: string, fullHandlerPath: string) => {
      return path.join(
        projectRoot,
        "lambda",
        "domains",
        domain,
        `${fullHandlerPath}.ts`,
      );
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
    map(apigw.HttpMethod.GET, "/projects/summary", "list-projects-summary");
  }
}
