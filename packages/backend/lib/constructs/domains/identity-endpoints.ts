import * as apigw from "aws-cdk-lib/aws-apigatewayv2";
import { Construct } from "constructs";
import * as path from "path";
import { DomainConstructFactory, DomainProps } from "./domain-constructs-factory";

export class IdentityEndpoints extends DomainConstructFactory {
  constructor(scope: Construct, id: string, props: DomainProps) {
    super(scope, id);

    const projectRoot = path.resolve(__dirname, "..", "..", "..");
    const getWorkspacesEntry = path.join(
      projectRoot,
      "lambda",
      "domains",
      "identity",
      "get-workspaces.ts",
    );

    this.addRoute({
      api: props.api,
      authorizer: props.authorizer,
      domainName: "identity",
      handlerEntry: getWorkspacesEntry,
      idPrefix: "Identity-",
      method: apigw.HttpMethod.GET,
      routePath: "/me/workspaces",
      stage: props.stage,
      table: props.table,
    });

    const createWorkspaceEntry = path.join(
      projectRoot,
      "lambda",
      "domains",
      "identity",
      "create-workspace.ts",
    );

    this.addRoute({
      actionName: "create-workspace",
      api: props.api,
      authorizer: props.authorizer,
      domainName: "identity",
      handlerEntry: createWorkspaceEntry,
      idPrefix: "Identity-",
      method: apigw.HttpMethod.POST,
      routePath: "/me/workspaces",
      stage: props.stage,
      table: props.table,
    });
  }
}
