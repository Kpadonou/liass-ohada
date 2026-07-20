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

    const cabinetTeamRoutes = [
      ["list-cabinet-members", apigw.HttpMethod.GET, "/cabinet/team/members"],
      [
        "get-cabinet-member",
        apigw.HttpMethod.GET,
        "/cabinet/team/members/{memberUserId}",
      ],
      [
        "update-cabinet-member-role",
        apigw.HttpMethod.PATCH,
        "/cabinet/team/members/{memberUserId}/role",
      ],
      [
        "update-cabinet-member-status",
        apigw.HttpMethod.PATCH,
        "/cabinet/team/members/{memberUserId}/status",
      ],
      [
        "list-cabinet-member-assignments",
        apigw.HttpMethod.GET,
        "/cabinet/team/members/{memberUserId}/assignments",
      ],
      [
        "replace-cabinet-member-assignments",
        apigw.HttpMethod.PUT,
        "/cabinet/team/members/{memberUserId}/assignments",
      ],
      [
        "create-cabinet-invitation",
        apigw.HttpMethod.POST,
        "/cabinet/team/invitations",
      ],
      [
        "list-cabinet-invitations",
        apigw.HttpMethod.GET,
        "/cabinet/team/invitations",
      ],
      [
        "cancel-cabinet-invitation",
        apigw.HttpMethod.POST,
        "/cabinet/team/invitations/{invitationId}/cancel",
      ],
      [
        "resend-cabinet-invitation",
        apigw.HttpMethod.POST,
        "/cabinet/team/invitations/{invitationId}/resend",
      ],
      [
        "list-cabinet-dossier-members",
        apigw.HttpMethod.GET,
        "/cabinet/dossiers/{dossierOrgId}/members",
      ],
      [
        "add-cabinet-dossier-member",
        apigw.HttpMethod.POST,
        "/cabinet/dossiers/{dossierOrgId}/members/{memberUserId}",
      ],
      [
        "remove-cabinet-dossier-member",
        apigw.HttpMethod.DELETE,
        "/cabinet/dossiers/{dossierOrgId}/members/{memberUserId}",
      ],
      [
        "accept-cabinet-invitation",
        apigw.HttpMethod.POST,
        "/me/cabinet-invitations/accept",
      ],
    ] as const;

    for (const [handlerName, method, routePath] of cabinetTeamRoutes) {
      this.addRoute({
        actionName: handlerName,
        api: props.api,
        authorizer: props.authorizer,
        domainName: "identity",
        handlerEntry: path.join(
          projectRoot,
          "lambda",
          "domains",
          "identity",
          `${handlerName}.ts`,
        ),
        idPrefix: "Identity-",
        lambdaRole: props.lambdaRole,
        method,
        routePath,
        routeInDomainStack:
          handlerName === "add-cabinet-dossier-member" ||
          handlerName === "remove-cabinet-dossier-member",
        stage: props.stage,
        table: props.table,
      });
    }

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
