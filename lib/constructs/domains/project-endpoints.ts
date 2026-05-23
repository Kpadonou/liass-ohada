import * as apigw from "aws-cdk-lib/aws-apigatewayv2";
import { Construct } from "constructs";
import * as path from "path";
import { DomainConstructFactory, DomainProps } from "./domain-constructs-factory";

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
      actionName?: string,
    ) => {
      const entry = resolveHandlerEntry("projects", handlerPath);
      this.addRoute({
        actionName,
        api: props.api,
        authorizer: props.authorizer,
        domainName: "projects",
        handlerEntry: entry,
        idPrefix: "Project-",
        method,
        routePath,
        stage: props.stage,
        table: props.table,
      });
    };

    // --- Project Domain Endpoints ---
    // Projects
    map(apigw.HttpMethod.POST, "/projects", "create-project");
    map(apigw.HttpMethod.GET, "/projects", "get-projects", "list-projects");
    map(
      apigw.HttpMethod.GET,
      "/projects/{projectId}",
      "get-projects",
      "get-project",
    );

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
