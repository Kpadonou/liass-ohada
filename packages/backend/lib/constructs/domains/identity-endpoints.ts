import * as apigw from "aws-cdk-lib/aws-apigatewayv2";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";
import * as path from "path";
import {
  DomainConstructFactory,
  DomainProps,
} from "./domain-constructs-factory";

export class IdentityEndpoints extends DomainConstructFactory {
  constructor(scope: Construct, id: string, props: DomainProps) {
    super(scope, id);

    const projectRoot = path.resolve(__dirname, "..", "..", "..");
    const productRoleAssignmentRole = new iam.Role(
      this,
      "InitialProductRoleAssignmentRole",
      {
        assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName(
            "service-role/AWSLambdaBasicExecutionRole",
          ),
        ],
      },
    );
    productRoleAssignmentRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          "dynamodb:GetItem",
          "dynamodb:UpdateItem",
          "dynamodb:PutItem",
          "dynamodb:ConditionCheckItem",
        ],
        resources: [props.table.tableArn],
      }),
    );
    this.addRoute({
      actionName: "assign-initial-product-role",
      api: props.api,
      authorizer: props.authorizer,
      domainName: "identity",
      handlerEntry: path.join(
        projectRoot,
        "lambda",
        "domains",
        "identity",
        "assign-initial-product-role.ts",
      ),
      idPrefix: "Identity-",
      lambdaRole: productRoleAssignmentRole,
      method: apigw.HttpMethod.PUT,
      routePath:
        "/me/organization/members/{memberUserId}/product-roles/{productCode}",
      routeInDomainStack: true,
      stage: props.stage,
      table: props.table,
    });
    const memberDirectoryRole = new iam.Role(
      this,
      "OrganizationMemberDirectoryRole",
      {
        assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName(
            "service-role/AWSLambdaBasicExecutionRole",
          ),
        ],
      },
    );
    memberDirectoryRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          "dynamodb:GetItem",
          "dynamodb:Query",
          "dynamodb:BatchGetItem",
        ],
        resources: [props.table.tableArn],
      }),
    );
    this.addRoute({
      actionName: "list-organization-members",
      api: props.api,
      authorizer: props.authorizer,
      domainName: "identity",
      handlerEntry: path.join(
        projectRoot,
        "lambda",
        "domains",
        "identity",
        "list-organization-members.ts",
      ),
      idPrefix: "Identity-",
      // A dedicated read-only execution role, rather than the legacy shared writer role.
      lambdaRole: memberDirectoryRole,
      method: apigw.HttpMethod.GET,
      routePath: "/me/organization/members",
      routeInDomainStack: true,
      stage: props.stage,
      table: props.table,
    });
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

    this.addRoute({
      actionName: "get-product-access",
      api: props.api,
      authorizer: props.authorizer,
      domainName: "identity",
      handlerEntry: path.join(
        projectRoot,
        "lambda",
        "domains",
        "identity",
        "get-product-access.ts",
      ),
      idPrefix: "Identity-",
      lambdaRole: props.lambdaRole,
      method: apigw.HttpMethod.GET,
      routePath: "/me/product-access",
      routeInDomainStack: true,
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
        environment:
          handlerName === "create-cabinet-invitation" ||
          handlerName === "resend-cabinet-invitation"
            ? {
                CABINET_INVITATION_EXPOSE_TOKEN:
                  props.stage === "prod" ? "false" : "true",
                NODE_ENV: props.stage === "prod" ? "production" : "development",
              }
            : undefined,
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

    const cabinetOperationsRoutes = [
      ["get-cabinet-settings", apigw.HttpMethod.GET, "/cabinet/settings"],
      ["update-cabinet-settings", apigw.HttpMethod.PATCH, "/cabinet/settings"],
      ["get-cabinet-dashboard", apigw.HttpMethod.GET, "/cabinet/dashboard"],
      ["list-cabinet-works", apigw.HttpMethod.GET, "/cabinet/works"],
      ["create-cabinet-work", apigw.HttpMethod.POST, "/cabinet/works"],
      ["get-cabinet-work", apigw.HttpMethod.GET, "/cabinet/works/{workId}"],
      [
        "update-cabinet-work",
        apigw.HttpMethod.PATCH,
        "/cabinet/works/{workId}",
      ],
      [
        "update-cabinet-work-status",
        apigw.HttpMethod.PATCH,
        "/cabinet/works/{workId}/status",
      ],
      ["list-cabinet-deadlines", apigw.HttpMethod.GET, "/cabinet/deadlines"],
      ["create-cabinet-deadline", apigw.HttpMethod.POST, "/cabinet/deadlines"],
      [
        "get-cabinet-deadline",
        apigw.HttpMethod.GET,
        "/cabinet/deadlines/{deadlineId}",
      ],
      [
        "update-cabinet-deadline",
        apigw.HttpMethod.PATCH,
        "/cabinet/deadlines/{deadlineId}",
      ],
      [
        "update-cabinet-deadline-status",
        apigw.HttpMethod.PATCH,
        "/cabinet/deadlines/{deadlineId}/status",
      ],
    ] as const;

    for (const [handlerName, method, routePath] of cabinetOperationsRoutes) {
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
        routeInDomainStack: true,
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
