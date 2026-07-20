import * as apigw from "aws-cdk-lib/aws-apigatewayv2";
import { Construct } from "constructs";
import * as path from "path";
import { DomainConstructFactory, DomainProps } from "./domain-constructs-factory";
import {
  PROJECT_ENDPOINT_PERMISSIONS,
  requireEndpointPermission,
} from "./accounting-endpoint-permissions";

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
      constructIdOverride?: string,
    ) => {
      const entry = resolveHandlerEntry("projects", handlerPath);
      this.addRoute({
        accountingPermission: requireEndpointPermission(
          PROJECT_ENDPOINT_PERMISSIONS,
          handlerPath,
        ),
        actionName,
        api: props.api,
        authorizer: props.authorizer,
        constructIdOverride,
        domainName: "projects",
        handlerEntry: entry,
        idPrefix: "Project-",
        lambdaRole: props.lambdaRole,
        method,
        routePath,
        stage: props.stage,
        table: props.table,
      });
    };

    // --- Project Domain Endpoints ---
    // Donor registry
    map(
      apigw.HttpMethod.POST,
      "/donors",
      "create-donor",
      undefined,
      // Preserve the deployed logical ID from the previous Projects CDK drift,
      // where this Lambda was accidentally attached to the funding-sources route.
      "Project-create-donor-POST-projects-projectId-funding-sources",
    );
    map(apigw.HttpMethod.GET, "/donors", "get-donors", "list-donors");

    // Projects
    map(apigw.HttpMethod.POST, "/projects", "create-project");
    map(apigw.HttpMethod.GET, "/projects", "get-projects", "list-projects");
    map(
      apigw.HttpMethod.GET,
      "/projects/{projectId}",
      "get-projects",
      "get-project",
    );

    // Funding sources (project-level donor envelopes)
    map(
      apigw.HttpMethod.POST,
      "/projects/{projectId}/funding-sources",
      "create-funding-source",
    );
    map(
      apigw.HttpMethod.GET,
      "/projects/{projectId}/funding-sources",
      "list-funding-sources",
    );

    // Budget lines
    map(
      apigw.HttpMethod.POST,
      "/projects/{projectId}/budget-lines",
      "create-budget-line",
    );
    map(
      apigw.HttpMethod.GET,
      "/projects/{projectId}/budget-lines",
      "list-budget-lines",
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
