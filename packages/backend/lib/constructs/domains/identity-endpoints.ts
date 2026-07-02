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
      lambdaRole: props.lambdaRole,
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
      lambdaRole: props.lambdaRole,
      method: apigw.HttpMethod.POST,
      routePath: "/me/workspaces",
      stage: props.stage,
      table: props.table,
    });

    const listCabinetDossiersEntry = path.join(
      projectRoot,
      "lambda",
      "domains",
      "identity",
      "list-cabinet-dossiers.ts",
    );

    this.addRoute({
      actionName: "list-cabinet-dossiers",
      api: props.api,
      authorizer: props.authorizer,
      domainName: "identity",
      handlerEntry: listCabinetDossiersEntry,
      idPrefix: "Identity-",
      lambdaRole: props.lambdaRole,
      method: apigw.HttpMethod.GET,
      routePath: "/cabinet/dossiers",
      stage: props.stage,
      table: props.table,
    });

    const createCabinetDossierEntry = path.join(
      projectRoot,
      "lambda",
      "domains",
      "identity",
      "create-cabinet-dossier.ts",
    );

    this.addRoute({
      actionName: "create-cabinet-dossier",
      api: props.api,
      authorizer: props.authorizer,
      domainName: "identity",
      handlerEntry: createCabinetDossierEntry,
      idPrefix: "Identity-",
      lambdaRole: props.lambdaRole,
      method: apigw.HttpMethod.POST,
      routePath: "/cabinet/dossiers",
      stage: props.stage,
      table: props.table,
    });
  }
}
