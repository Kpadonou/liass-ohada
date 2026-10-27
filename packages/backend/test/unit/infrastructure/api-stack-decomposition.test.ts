import { Template } from "aws-cdk-lib/assertions";
import { RestaurantsGuestEndpoints } from "../../../lib/constructs/domains/restaurants-guest-endpoints";
import * as cdk from "aws-cdk-lib";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";
import {
  INVENTORY_GATEWAY_PATH,
  INVENTORY_GATEWAY_METHODS,
} from "../../../lambda/domains/restaurants/inventory-routes";
import { LiassOhadaBackendStack } from "../../../lib/liass-ohada-backend-stack";
import {
  AccountingApiStack,
  FiscalComplianceApiStack,
  IdentityApiStack,
  ProjectApiStack,
  SalesApiStack,
  RestaurantsApiStack,
  TreasuryApiStack,
} from "../../../lib/stacks/api-domain-stacks";

const FROZEN_GUEST_ROUTES = [
  ["POST", "/public/restaurants/guest/submissions"],
  ["GET", "/public/restaurants/guest/state"],
  ["POST", "/public/restaurants/guest/waiter-call"],
  ["GET", "/restaurants/outlets/{outletId}/guest-activity"],
  [
    "GET",
    "/restaurants/outlets/{outletId}/sessions/{sessionId}/guest-requests",
  ],
  [
    "POST",
    "/restaurants/outlets/{outletId}/sessions/{sessionId}/guest-requests/{requestId}/approve",
  ],
  [
    "POST",
    "/restaurants/outlets/{outletId}/sessions/{sessionId}/guest-requests/{requestId}/reject",
  ],
  [
    "POST",
    "/restaurants/outlets/{outletId}/waiter-calls/{waiterCallId}/acknowledge",
  ],
];

jest.mock("aws-cdk-lib/aws-lambda-nodejs", () => {
  const lambda = jest.requireActual<typeof import("aws-cdk-lib/aws-lambda")>(
    "aws-cdk-lib/aws-lambda",
  );
  return {
    NodejsFunction: class extends lambda.Function {
      constructor(
        scope: Construct,
        id: string,
        props: import("aws-cdk-lib/aws-lambda").FunctionProps,
      ) {
        super(scope, id, {
          ...props,
          code: lambda.Code.fromInline("exports.handler = async () => ({});"),
          handler: "index.handler",
        });
      }
    },
  };
});

function lambdaEnvironmentVariable(
  fn: lambda.CfnFunction,
  name: string,
): unknown {
  const environment = cdk.Stack.of(fn).resolve(fn.environment) as
    | lambda.CfnFunction.EnvironmentProperty
    | undefined;
  const variables = environment?.variables;
  return variables && typeof variables === "object"
    ? (variables as Record<string, unknown>)[name]
    : undefined;
}

describe("API stack decomposition", () => {
  const app = new cdk.App({
    context: {
      authUseSecretsManager: true,
    },
  });
  const root = new LiassOhadaBackendStack(app, "TestBackend", {
    stage: "dev",
    env: { account: "123456789012", region: "eu-west-3" },
  });
  const constructs = root.node.findAll();

  test("COMPANY invitations stay in Identity with JWT, explicit development token policy and no Scan/index IAM", () => {
    for (const [handlerName, path] of [
      ["create-organization-invitation", "/me/organization/invitations"],
      ["accept-organization-invitation", "/me/organization/invitations/accept"],
    ]) {
      const fn = constructs.find(
        (item): item is lambda.CfnFunction =>
          item instanceof lambda.CfnFunction &&
          item.functionName === `liass-ohada-dev-identity-${handlerName}`,
      );
      expect(fn).toBeDefined();
      expect(cdk.Stack.of(fn!)).toBeInstanceOf(IdentityApiStack);
      expect(lambdaEnvironmentVariable(fn!, "NODE_ENV")).toBe("development");
      expect(
        lambdaEnvironmentVariable(fn!, "ORGANIZATION_INVITATION_EXPOSE_TOKEN"),
      ).toBe("true");
      const route = constructs.find(
        (item): item is apigwv2.CfnRoute =>
          item instanceof apigwv2.CfnRoute && item.routeKey === `POST ${path}`,
      );
      expect(route?.authorizationType).toBe("JWT");
      expect(cdk.Stack.of(route!)).toBeInstanceOf(IdentityApiStack);
    }
    const policy = constructs.find(
      (item): item is iam.CfnPolicy =>
        item instanceof iam.CfnPolicy &&
        item.node.path.includes("OrganizationInvitationRole"),
    );
    const document = cdk.Stack.of(policy!).resolve(policy!.policyDocument);
    expect(document.Statement).toHaveLength(1);
    expect(document.Statement[0].Action.sort()).toEqual([
      "dynamodb:ConditionCheckItem",
      "dynamodb:DeleteItem",
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:UpdateItem",
    ]);
    expect(JSON.stringify(document.Statement[0].Resource)).toContain(
      "AccountingTable",
    );
    expect(JSON.stringify(document.Statement[0].Resource)).not.toContain(
      "/index/",
    );
    expect(JSON.stringify(document)).not.toContain("RestaurantsTable");
  });

  test("production COMPANY invitations never expose raw tokens", () => {
    const production = new LiassOhadaBackendStack(
      new cdk.App({
        context: {
          authUseSecretsManager: true,
          "auth.prod.callbackUrls": ["https://app.example.test/auth/callback"],
          "auth.prod.logoutUrls": ["https://app.example.test/login"],
        },
      }),
      "ProductionInvitationTest",
      {
        stage: "prod",
        env: { account: "123456789012", region: "eu-west-3" },
      },
    );
    const functions = production.node
      .findAll()
      .filter(
        (item): item is lambda.CfnFunction =>
          item instanceof lambda.CfnFunction &&
          String(item.functionName).includes("organization-invitation"),
      );
    expect(functions).toHaveLength(2);
    for (const fn of functions) {
      expect(lambdaEnvironmentVariable(fn, "NODE_ENV")).toBe("production");
      expect(
        lambdaEnvironmentVariable(fn, "ORGANIZATION_INVITATION_EXPOSE_TOKEN"),
      ).toBe("false");
    }
  });

  test("initial product-role assignment stays in Identity with narrowly scoped transaction IAM", () => {
    const fn = constructs.find(
      (item): item is lambda.CfnFunction =>
        item instanceof lambda.CfnFunction &&
        item.functionName ===
          "liass-ohada-dev-identity-assign-initial-product-role",
    );
    expect(fn).toBeDefined();
    expect(cdk.Stack.of(fn!)).toBeInstanceOf(IdentityApiStack);
    const route = constructs.find(
      (item): item is apigwv2.CfnRoute =>
        item instanceof apigwv2.CfnRoute &&
        item.routeKey ===
          "PUT /me/organization/members/{memberUserId}/product-roles/{productCode}",
    );
    expect(route?.authorizationType).toBe("JWT");
    expect(cdk.Stack.of(route!)).toBeInstanceOf(IdentityApiStack);
    const policy = constructs.find(
      (item): item is iam.CfnPolicy =>
        item instanceof iam.CfnPolicy &&
        item.node.path.includes("InitialProductRoleAssignmentRole"),
    );
    const document = cdk.Stack.of(policy!).resolve(policy!.policyDocument);
    expect(document.Statement).toHaveLength(1);
    expect(document.Statement[0].Action.sort()).toEqual([
      "dynamodb:ConditionCheckItem",
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:UpdateItem",
    ]);
    expect(JSON.stringify(document.Statement[0].Resource)).toContain(
      "AccountingTable",
    );
    expect(JSON.stringify(document.Statement[0].Resource)).not.toContain(
      "/index/",
    );
  });

  test("keeps the COMPANY member directory in Identity with JWT and table-only read IAM", () => {
    const directory = constructs.find(
      (item): item is lambda.CfnFunction =>
        item instanceof lambda.CfnFunction &&
        item.functionName ===
          "liass-ohada-dev-identity-list-organization-members",
    );
    expect(directory).toBeDefined();
    expect(cdk.Stack.of(directory!)).toBeInstanceOf(IdentityApiStack);
    const route = constructs.find(
      (item): item is apigwv2.CfnRoute =>
        item instanceof apigwv2.CfnRoute &&
        item.routeKey === "GET /me/organization/members",
    );
    expect(cdk.Stack.of(route!)).toBeInstanceOf(IdentityApiStack);
    expect(route?.authorizationType).toBe("JWT");
    const policy = constructs.find(
      (item): item is iam.CfnPolicy =>
        item instanceof iam.CfnPolicy &&
        item.node.path.includes("OrganizationMemberDirectoryRole"),
    );
    expect(policy).toBeDefined();
    const document = cdk.Stack.of(policy!).resolve(policy!.policyDocument);
    expect(document.Statement).toHaveLength(1);
    expect(document.Statement[0].Action.sort()).toEqual([
      "dynamodb:BatchGetItem",
      "dynamodb:GetItem",
      "dynamodb:Query",
    ]);
    expect(JSON.stringify(document.Statement[0].Resource)).not.toContain(
      "/index/",
    );
    expect(JSON.stringify(document.Statement[0].Resource)).toContain(
      "AccountingTable",
    );
  });

  test("keeps the shared and Restaurants stateful tables, private document bucket, User Pool, and HTTP API", () => {
    expect(
      constructs.filter((item) => item instanceof dynamodb.CfnTable),
    ).toHaveLength(2);
    expect(
      constructs.filter((item) => item instanceof s3.CfnBucket),
    ).toHaveLength(1);
    expect(
      constructs.filter((item) => item instanceof cognito.CfnUserPool),
    ).toHaveLength(1);
    expect(
      constructs.filter((item) => item instanceof apigwv2.CfnApi),
    ).toHaveLength(1);
  });

  test("maps Google's verified-email assertion into the shared User Pool", () => {
    const googleProvider = constructs.find(
      (item): item is cognito.CfnUserPoolIdentityProvider =>
        item instanceof cognito.CfnUserPoolIdentityProvider &&
        item.providerName === "Google",
    );

    expect(googleProvider?.attributeMapping).toMatchObject({
      email: "email",
      email_verified: "email_verified",
    });
  });

  test("creates one nested API stack per current domain", () => {
    expect(
      constructs.filter((item) => item instanceof IdentityApiStack),
    ).toHaveLength(1);
    expect(
      constructs.filter((item) => item instanceof AccountingApiStack),
    ).toHaveLength(1);
    expect(
      constructs.filter((item) => item instanceof ProjectApiStack),
    ).toHaveLength(1);
    expect(
      constructs.filter((item) => item instanceof TreasuryApiStack),
    ).toHaveLength(1);
    expect(
      constructs.filter((item) => item instanceof SalesApiStack),
    ).toHaveLength(1);
    expect(
      constructs.filter((item) => item instanceof RestaurantsApiStack),
    ).toHaveLength(1);
    expect(
      constructs.filter((item) => item instanceof FiscalComplianceApiStack),
    ).toHaveLength(1);
  });

  test("preserves expected identity and business routes on the shared API", () => {
    const routeKeys = constructs
      .filter(
        (item): item is apigwv2.CfnRoute => item instanceof apigwv2.CfnRoute,
      )
      .map((route) => route.routeKey);
    expect(routeKeys).toEqual(
      expect.arrayContaining([
        "GET /me/workspaces",
        "GET /me/product-access",
        "GET /cabinet/team/members",
        "POST /me/cabinet-invitations/accept",
        "GET /accounts",
        "GET /projects",
        "GET /treasury/summary",
        "POST /sales/customers",
        "GET /sales/customers",
        "GET /sales/customers/{customerId}",
        "PATCH /sales/customers/{customerId}",
        "POST /sales/customers/{customerId}/activate",
        "POST /sales/customers/{customerId}/deactivate",
        "POST /sales/items",
        "GET /sales/items",
        "GET /sales/items/{itemId}",
        "PATCH /sales/items/{itemId}",
        "POST /sales/items/{itemId}/activate",
        "POST /sales/items/{itemId}/deactivate",
        "POST /sales/invoices/{invoiceId}/issue",
        "POST /sales/invoices/{invoiceId}/documents/pdf",
        "GET /sales/invoices/{invoiceId}/documents/pdf",
        "POST /sales/invoices/{invoiceId}/documents/pdf/download-url",
        "POST /sales/invoices/{invoiceId}/credit-notes/{creditNoteId}/documents/pdf",
        "GET /sales/invoices/{invoiceId}/credit-notes/{creditNoteId}/documents/pdf",
        "POST /sales/invoices/{invoiceId}/credit-notes/{creditNoteId}/documents/pdf/download-url",
      ]),
    );
  });

  test("keeps all ten fiscal routes, integrations and functions in the Fiscal Compliance nested stack", () => {
    const fiscal = constructs.find(
      (item) => item instanceof FiscalComplianceApiStack,
    )!;
    const owned = fiscal.node.findAll();
    const functions = owned.filter(
      (item): item is lambda.CfnFunction => item instanceof lambda.CfnFunction,
    );
    const routes = owned.filter(
      (item): item is apigwv2.CfnRoute => item instanceof apigwv2.CfnRoute,
    );
    expect(functions).toHaveLength(10);
    expect(routes).toHaveLength(10);
    expect(
      owned.filter((item) => item instanceof apigwv2.CfnIntegration),
    ).toHaveLength(10);
    expect(routes.every((route) => route.authorizationType === "JWT")).toBe(
      true,
    );
    expect(routes.map((route) => route.routeKey)).toEqual(
      expect.arrayContaining([
        "GET /fiscal-compliance/benin/profile",
        "PUT /fiscal-compliance/benin/profile",
        "POST /fiscal-compliance/certifications",
        "POST /fiscal-compliance/readiness",
      ]),
    );
    expect(routes.map((route) => route.routeKey).join(" ")).not.toMatch(
      /\/(submit|confirm|cancel|retry|reconcile)/,
    );
    expect(
      functions.every(
        (fn) => !lambdaEnvironmentVariable(fn, "ACCOUNTING_PERMISSION"),
      ),
    ).toBe(true);
    expect(
      functions.every(
        (fn) => !lambdaEnvironmentVariable(fn, "SALES_DOCUMENT_BUCKET_NAME"),
      ),
    ).toBe(true);
    expect(
      owned.filter(
        (item) =>
          item instanceof dynamodb.CfnTable || item instanceof s3.CfnBucket,
      ),
    ).toHaveLength(0);
  });

  test("keeps Restaurants routes and grouped Guest boundaries in one domain stack", () => {
    const restaurants = constructs.find(
      (item) => item instanceof RestaurantsApiStack,
    )!;
    const owned = restaurants.node.findAll();
    const functions = owned.filter(
      (item): item is lambda.CfnFunction => item instanceof lambda.CfnFunction,
    );
    const routes = owned.filter(
      (item): item is apigwv2.CfnRoute => item instanceof apigwv2.CfnRoute,
    );
    expect(functions).toHaveLength(77);
    expect(routes).toHaveLength(98);
    expect(
      owned.filter((item) => item instanceof apigwv2.CfnIntegration),
    ).toHaveLength(77);
    expect(
      owned.filter((item) => item instanceof lambda.CfnPermission),
    ).toHaveLength(87);
    const publicRoutes = routes.filter((route) =>
      String(route.routeKey).includes(" /public/"),
    );
    expect(publicRoutes.map((route) => route.routeKey).sort()).toEqual([
      "GET /public/restaurants/guest/carte",
      "GET /public/restaurants/guest/state",
      "POST /public/restaurants/guest/renew",
      "POST /public/restaurants/guest/resolve",
      "POST /public/restaurants/guest/submissions",
      "POST /public/restaurants/guest/waiter-call",
    ]);
    expect(
      publicRoutes.every((route) => route.authorizationType === "NONE"),
    ).toBe(true);
    expect(
      routes
        .filter((route) => !publicRoutes.includes(route))
        .every((route) => route.authorizationType === "JWT"),
    ).toBe(true);
    expect(
      routes.every(
        (route) =>
          String(route.routeKey).includes(" /restaurants/") ||
          String(route.routeKey).includes(" /public/restaurants/guest/"),
      ),
    ).toBe(true);
    expect(
      functions.every(
        (fn) => !lambdaEnvironmentVariable(fn, "ACCOUNTING_PERMISSION"),
      ),
    ).toBe(true);
    expect(
      owned.filter(
        (item) =>
          item instanceof dynamodb.CfnTable ||
          item instanceof cognito.CfnUserPool ||
          item instanceof apigwv2.CfnApi,
      ),
    ).toHaveLength(0);
  });

  test("Inventory reuses the original Outlet Lambda/integration with bounded JWT routes and invocation", () => {
    const restaurants = constructs.find(
      (item): item is RestaurantsApiStack =>
        item instanceof RestaurantsApiStack,
    )!;
    const owned = restaurants.node.findAll();
    const management = owned.find(
      (item): item is lambda.CfnFunction =>
        item instanceof lambda.CfnFunction &&
        item.functionName === "liass-ohada-dev-restaurants-get-outlet",
    )!;
    expect(restaurants.getLogicalId(management)).toBe(
      "RestaurantsModuleRestaurantsgetoutletGETrestaurantsoutletsoutletId915B5431",
    );
    const routes = owned.filter(
      (item): item is apigwv2.CfnRoute => item instanceof apigwv2.CfnRoute,
    );
    const original = routes.find(
      (route) => route.routeKey === "GET /restaurants/outlets/{outletId}",
    )!;
    for (const routeKey of INVENTORY_GATEWAY_METHODS.map(
      (method) => `${method} ${INVENTORY_GATEWAY_PATH}`,
    )) {
      const route = routes.find((r) => r.routeKey === routeKey)!;
      expect(route).toBeDefined();
      expect(route.authorizationType).toBe("JWT");
      expect(restaurants.resolve(route.target)).toEqual(
        restaurants.resolve(original.target),
      );
    }
    for (const name of [
      "create-outlet",
      "update-outlet",
      "list-outlet",
      "deactivate-outlet",
    ])
      expect(
        owned
          .filter(
            (item): item is lambda.CfnFunction =>
              item instanceof lambda.CfnFunction,
          )
          .some(
            (fn) => fn.functionName === `liass-ohada-dev-restaurants-${name}`,
          ),
      ).toBe(false);
    const permissions = management.node
      .scope!.node.findAll()
      .filter(
        (item): item is lambda.CfnPermission =>
          item instanceof lambda.CfnPermission,
      );
    expect(permissions).toHaveLength(8);
    const arns = permissions.map((permission) => {
      expect(permission.principal).toBe("apigateway.amazonaws.com");
      expect(restaurants.resolve(permission.sourceAccount)).toBe(
        "123456789012",
      );
      return JSON.stringify(restaurants.resolve(permission.sourceArn));
    });
    expect(arns.filter((arn) => arn.includes("/inventory/items"))).toHaveLength(
      2,
    );
    expect(arns.join(" ")).toContain(
      "/$default/*/restaurants/outlets/*/inventory/items",
    );
    expect(arns.join(" ")).not.toContain("/$default/*/*");
    expect(arns.join(" ")).toContain("/inventory/menu-items/*/tracking");
    expect(
      Object.keys(Template.fromStack(restaurants).toJSON().Resources).length,
    ).toBeLessThanOrEqual(344);
  });

  test.each([
    "/restaurants/outlets/outlet/inventory/items",
    "/restaurants/outlets/outlet/inventory/items/item",
    "/restaurants/outlets/outlet/inventory/items/item/movements",
    "/restaurants/outlets/outlet/inventory/menu-items/item/tracking",
  ])(
    "Inventory anonymous preflight for %s remains owned by the shared HTTP API CORS responder",
    (path) => {
      const api = constructs.find(
        (item): item is apigwv2.CfnApi => item instanceof apigwv2.CfnApi,
      )!;
      const template = Template.fromStack(cdk.Stack.of(api)).toJSON();
      const resource = template.Resources[cdk.Stack.of(api).getLogicalId(api)];
      expect(resource.Properties.CorsConfiguration).toEqual({
        AllowOrigins: ["*"],
        AllowMethods: ["GET", "POST", "OPTIONS", "PUT", "PATCH", "DELETE"],
        AllowHeaders: [
          "content-type",
          "if-none-match",
          "x-amz-date",
          "authorization",
          "x-api-key",
          "accept-language",
          "x-org-id",
          "x-workspace-org-id",
        ],
        ExposeHeaders: ["ETag"],
      });
      const routes = constructs.filter(
        (item): item is apigwv2.CfnRoute => item instanceof apigwv2.CfnRoute,
      );
      expect(routes.some((route) => route.routeKey === "$default")).toBe(false);
      // An ANY route (including an ancestor greedy route) would capture OPTIONS
      // before managed CORS. Assert none can match these concrete preflight paths.
      const matches = (pattern: string) =>
        new RegExp(
          "^" +
            pattern.replace(/\{proxy\+\}/g, ".+").replace(/\{\w+\}/g, "[^/]+") +
            "$",
        ).test(path);
      expect(
        routes.filter((route) => {
          const [method, pattern] = String(route.routeKey).split(" ");
          return ["ANY", "OPTIONS"].includes(method) && matches(pattern);
        }),
      ).toEqual([]);
      // No explicit OPTIONS route, integration, Lambda or authorizer is needed:
      // the existing CorsConfiguration supplies the anonymous preflight response.
    },
  );

  test.each([
    ["GET", "items"],
    ["POST", "items"],
    ["GET", "items/item"],
    ["PATCH", "items/item"],
    ["POST", "items/item/movements"],
    ["GET", "items/item/movements"],
    ["GET", "menu-items/item/tracking"],
    ["PUT", "menu-items/item/tracking"],
    ["DELETE", "menu-items/item/tracking"],
  ])(
    "Inventory business request %s %s retains the original JWT authorizer",
    (method) => {
      const restaurants = constructs.find(
        (item): item is RestaurantsApiStack =>
          item instanceof RestaurantsApiStack,
      )!;
      const routes = restaurants.node
        .findAll()
        .filter(
          (item): item is apigwv2.CfnRoute => item instanceof apigwv2.CfnRoute,
        );
      const route = routes.find(
        (r) => r.routeKey === `${method} ${INVENTORY_GATEWAY_PATH}`,
      )!;
      const original = routes.find(
        (r) => r.routeKey === "GET /restaurants/outlets/{outletId}",
      )!;
      expect(route).toBeDefined();
      expect(route.authorizationType).toBe("JWT");
      expect(restaurants.resolve(route.authorizerId)).toEqual(
        restaurants.resolve(original.authorizerId),
      );
      expect(restaurants.resolve(route.target)).toEqual(
        restaurants.resolve(original.target),
      );
    },
  );

  test("isolates Restaurants write permissions and protects the new stateful table", () => {
    const restaurants = constructs.find(
      (item) => item instanceof RestaurantsApiStack,
    )!;
    const owned = restaurants.node.findAll();
    const functions = owned.filter(
      (item): item is lambda.CfnFunction => item instanceof lambda.CfnFunction,
    );
    expect(
      functions.every(
        (fn) =>
          lambdaEnvironmentVariable(fn, "PLATFORM_TABLE_NAME") &&
          lambdaEnvironmentVariable(fn, "RESTAURANTS_TABLE_NAME"),
      ),
    ).toBe(true);
    const executionRole = owned.find(
      (item): item is iam.Role => item instanceof iam.Role,
    )!;
    for (const fn of functions.filter(
      (fn) => !String(fn.functionName).endsWith("-guest-public"),
    ))
      expect(cdk.Stack.of(fn).resolve(fn.role)).toEqual(
        cdk.Stack.of(fn).resolve(executionRole.roleArn),
      );
    const publicRole = owned.find(
      (item): item is iam.CfnRole =>
        item instanceof iam.CfnRole && item.node.path.includes("PublicRole"),
    )!;
    const policies = cdk.Stack.of(publicRole).resolve(publicRole.policies);
    expect(policies).toHaveLength(1);
    const publicDocument = policies[0].policyDocument;
    const publicActions = publicDocument.Statement.flatMap(
      (entry: { Action: string | string[] }) =>
        Array.isArray(entry.Action) ? entry.Action : [entry.Action],
    );
    expect(
      publicActions.filter((action: string) => action.startsWith("dynamodb:")),
    ).toEqual([
      "dynamodb:GetItem",
      "dynamodb:ConditionCheckItem",
      "dynamodb:Query",
      "dynamodb:BatchGetItem",
      "dynamodb:PutItem",
      "dynamodb:DeleteItem",
    ]);
    expect(publicActions).toContain("secretsmanager:GetSecretValue");
    const policy = owned.find(
      (item): item is iam.CfnPolicy => item instanceof iam.CfnPolicy,
    )!;
    const document = cdk.Stack.of(policy).resolve(policy.policyDocument);
    const statements = document.Statement.filter(
      (entry: { Action: string[] }) =>
        entry.Action.some((action) => action.startsWith("dynamodb:")),
    );
    expect(statements).toHaveLength(2);
    expect(statements[0].Action).toEqual([
      "dynamodb:GetItem",
      "dynamodb:BatchGetItem",
      "dynamodb:ConditionCheckItem",
    ]);
    expect(statements[1].Action).toEqual([
      "dynamodb:GetItem",
      "dynamodb:Query",
      "dynamodb:BatchGetItem",
      "dynamodb:PutItem",
      "dynamodb:DeleteItem",
      "dynamodb:ConditionCheckItem",
    ]);
    expect(JSON.stringify(statements[0].Resource)).not.toBe(
      JSON.stringify(statements[1].Resource),
    );
    const table = constructs.find(
      (item): item is dynamodb.CfnTable =>
        item instanceof dynamodb.CfnTable &&
        String(item.tableName).endsWith("restaurants-table"),
    )!;
    expect(table.billingMode).toBe("PAY_PER_REQUEST");
    expect(
      cdk.Stack.of(table).resolve(table.globalSecondaryIndexes) ?? [],
    ).toEqual([]);
    expect(table.deletionProtectionEnabled).toBe(true);
    expect(table.pointInTimeRecoverySpecification).toEqual({
      pointInTimeRecoveryEnabled: true,
    });
    expect(table.cfnOptions.deletionPolicy).toBe(cdk.CfnDeletionPolicy.RETAIN);
    expect(table.cfnOptions.updateReplacePolicy).toBe(
      cdk.CfnDeletionPolicy.RETAIN,
    );
    const newTableId = cdk.Stack.of(table).getLogicalId(table);
    for (const stack of constructs.filter(
      (item) =>
        item instanceof AccountingApiStack ||
        item instanceof SalesApiStack ||
        item instanceof IdentityApiStack,
    )) {
      const resources = stack.node
        .findAll()
        .filter(
          (item) =>
            item instanceof iam.CfnPolicy || item instanceof lambda.CfnFunction,
        );
      for (const resource of resources)
        expect(
          JSON.stringify(
            cdk.Stack.of(resource).resolve(
              resource instanceof iam.CfnPolicy
                ? resource.policyDocument
                : (resource as lambda.CfnFunction).environment,
            ),
          ),
        ).not.toContain(newTableId);
    }
    const coreRole = constructs.find(
      (item): item is iam.Role =>
        item instanceof iam.Role && item.node.id === "ApiLambdaExecutionRole",
    )!;
    for (const item of coreRole.node.findAll())
      if (item instanceof iam.CfnPolicy)
        expect(
          JSON.stringify(cdk.Stack.of(item).resolve(item.policyDocument)),
        ).not.toContain(newTableId);
  });

  test("does not add a physical index", () => {
    const table = constructs.find(
      (item): item is dynamodb.CfnTable => item instanceof dynamodb.CfnTable,
    );
    expect(table?.globalSecondaryIndexes).toHaveLength(7);
  });

  test("uses the canonical domain-oriented names for nested-stack Lambdas", () => {
    const functions = constructs.filter(
      (item): item is lambda.CfnFunction => item instanceof lambda.CfnFunction,
    );
    expect(functions.length).toBeGreaterThan(0);
    expect(
      functions.every((fn) =>
        /^liass-ohada-dev-(identity|accounting|projects|treasury|sales|restaurants|fiscal-compliance)-/.test(
          String(fn.functionName),
        ),
      ),
    ).toBe(true);
  });

  test("keeps all thirty-seven SALES Lambdas in the SALES domain without Accounting fallback", () => {
    const functions = constructs.filter(
      (item): item is lambda.CfnFunction => item instanceof lambda.CfnFunction,
    );
    const salesFunctions = functions.filter((fn) =>
      String(fn.functionName).includes("-dev-sales-"),
    );
    expect(salesFunctions).toHaveLength(37);
    expect(
      salesFunctions.every(
        (fn) => !lambdaEnvironmentVariable(fn, "ACCOUNTING_PERMISSION"),
      ),
    ).toBe(true);
  });

  test("configures the document bucket as encrypted, public-blocked, retained, and TLS-only", () => {
    const bucket = constructs.find(
      (item): item is s3.CfnBucket => item instanceof s3.CfnBucket,
    );
    expect(bucket).toBeDefined();
    expect(bucket?.bucketEncryption).toBeDefined();
    expect(bucket?.publicAccessBlockConfiguration).toEqual({
      blockPublicAcls: true,
      blockPublicPolicy: true,
      ignorePublicAcls: true,
      restrictPublicBuckets: true,
    });
    expect(bucket?.cfnOptions.deletionPolicy).toBe(
      cdk.CfnDeletionPolicy.RETAIN,
    );

    const policies = constructs.filter(
      (item): item is s3.CfnBucketPolicy => item instanceof s3.CfnBucketPolicy,
    );
    expect(policies).toHaveLength(1);
    expect(
      JSON.stringify(
        cdk.Stack.of(policies[0]).resolve(policies[0].policyDocument),
      ),
    ).toContain("aws:SecureTransport");
  });

  test("exposes the private bucket only to the six SALES document Lambdas", () => {
    const functions = constructs.filter(
      (item): item is lambda.CfnFunction => item instanceof lambda.CfnFunction,
    );
    const withBucket = functions.filter((fn) =>
      lambdaEnvironmentVariable(fn, "SALES_DOCUMENT_BUCKET_NAME"),
    );
    expect(withBucket).toHaveLength(6);
    expect(
      withBucket.every((fn) => String(fn.functionName).includes("pdf")),
    ).toBe(true);
  });

  test("limits document Lambda data access to exact item and object actions", () => {
    const documentPolicies = constructs.filter(
      (item): item is iam.CfnPolicy =>
        item instanceof iam.CfnPolicy &&
        /(?:invoice|credit-note)-pdf/i.test(item.node.path),
    );
    expect(documentPolicies).toHaveLength(6);
    const serialized = documentPolicies.map((policy) =>
      JSON.stringify(cdk.Stack.of(policy).resolve(policy.policyDocument)),
    );
    expect(
      serialized.every((policy) => policy.includes("dynamodb:GetItem")),
    ).toBe(true);
    expect(
      serialized.filter((policy) => policy.includes("dynamodb:PutItem")),
    ).toHaveLength(2);
    expect(serialized.every((policy) => policy.includes("s3:GetObject"))).toBe(
      true,
    );
    expect(
      serialized.filter((policy) => policy.includes("s3:PutObject")),
    ).toHaveLength(2);
    for (const policy of serialized) {
      expect(policy).not.toMatch(
        /dynamodb:(Scan|DeleteItem|BatchWriteItem|\*)/,
      );
      expect(policy).not.toMatch(/s3:(List|DeleteObject|\*)/);
    }
  });

  test("keeps Accounting permission fallback out of Projects and Treasury Lambdas", () => {
    const functions = constructs.filter(
      (item): item is lambda.CfnFunction => item instanceof lambda.CfnFunction,
    );
    const projectAndTreasuryFunctions = functions.filter((fn) =>
      /-dev-(projects|treasury)-/.test(String(fn.functionName)),
    );
    const accountingFunctions = functions.filter((fn) =>
      String(fn.functionName).includes("-dev-accounting-"),
    );

    expect(projectAndTreasuryFunctions).toHaveLength(21);
    expect(
      projectAndTreasuryFunctions.every(
        (fn) => !lambdaEnvironmentVariable(fn, "ACCOUNTING_PERMISSION"),
      ),
    ).toBe(true);
    expect(accountingFunctions).toHaveLength(50);
    expect(
      accountingFunctions.every((fn) =>
        lambdaEnvironmentVariable(fn, "ACCOUNTING_PERMISSION"),
      ),
    ).toBe(true);
  });

  test("exposes invitation tokens only from development invitation Lambdas", () => {
    const functions = constructs.filter(
      (item): item is lambda.CfnFunction => item instanceof lambda.CfnFunction,
    );
    const invitationFunctions = functions.filter((fn) =>
      ["create-cabinet-invitation", "resend-cabinet-invitation"].some((name) =>
        String(fn.functionName).includes(name),
      ),
    );
    expect(invitationFunctions).toHaveLength(2);
    expect(
      invitationFunctions.every(
        (fn) =>
          lambdaEnvironmentVariable(fn, "CABINET_INVITATION_EXPOSE_TOKEN") ===
          "true",
      ),
    ).toBe(true);
    expect(
      functions
        .filter((fn) => !invitationFunctions.includes(fn))
        .every(
          (fn) =>
            !lambdaEnvironmentVariable(fn, "CABINET_INVITATION_EXPOSE_TOKEN"),
        ),
    ).toBe(true);
  });
  test("orders the parent Stage after the Restaurants nested routes in CloudFormation", () => {
    const stage = constructs.find(
      (item): item is apigwv2.CfnStage => item instanceof apigwv2.CfnStage,
    )!;
    const restaurants = constructs.find(
      (item): item is RestaurantsApiStack =>
        item instanceof RestaurantsApiStack,
    )!;
    const owner = cdk.Stack.of(stage);
    const nestedId = owner.getLogicalId(restaurants.nestedStackResource!);
    const template = Template.fromStack(owner).toJSON();
    const stageResource = template.Resources[owner.getLogicalId(stage)];
    expect(template.Resources[nestedId].Type).toBe(
      "AWS::CloudFormation::Stack",
    );
    expect(stageResource.DependsOn ?? []).toContain(nestedId);
  });

  test("serializes Guest throttling with CloudFormation property casing", () => {
    const stage = constructs.find(
      (item): item is apigwv2.CfnStage => item instanceof apigwv2.CfnStage,
    )!;
    const template = Template.fromStack(cdk.Stack.of(stage));
    const stages = Object.values(
      template.findResources("AWS::ApiGatewayV2::Stage"),
    );
    expect(stages).toHaveLength(1);
    const settings = stages[0].Properties.RouteSettings;
    expect(settings["GET /public/restaurants/guest/carte"]).toEqual({
      ThrottlingBurstLimit: 20,
      ThrottlingRateLimit: 10,
    });
    for (const operation of ["resolve", "renew"]) {
      const entry = settings[`POST /public/restaurants/guest/${operation}`];
      expect(entry).toEqual({
        ThrottlingBurstLimit: 20,
        ThrottlingRateLimit: 10,
      });
      expect(entry).not.toHaveProperty("throttlingBurstLimit");
      expect(entry).not.toHaveProperty("throttlingRateLimit");
    }
  });

  test("bounds Guest invocation to the exact API/stage and rejects unrelated routes", () => {
    const guest = constructs.find(
      (item): item is RestaurantsGuestEndpoints =>
        item instanceof RestaurantsGuestEndpoints,
    )!;
    const permissions = guest.node
      .findAll()
      .filter(
        (item): item is lambda.CfnPermission =>
          item instanceof lambda.CfnPermission,
      );
    expect(permissions).toHaveLength(5);
    const arn = (permission: lambda.CfnPermission) => {
      const resolved = cdk.Stack.of(permission).resolve(permission.sourceArn);
      expect(resolved["Fn::Join"][0]).toBe("");
      return resolved["Fn::Join"][1]
        .map((part: unknown) =>
          typeof part === "string"
            ? part
            : (part as { Ref?: string }).Ref === "AWS::Partition"
              ? "aws"
              : "review-api",
        )
        .join("");
    };
    const publicPermission = permissions.find(
      (p) => p.node.id === "PublicGuestInvoke",
    )!;
    const staffPermission = permissions.find(
      (p) => p.node.id === "StaffQrInvoke",
    )!;
    const publicArn = arn(publicPermission),
      staffArn = arn(staffPermission);
    expect(
      arn(permissions.find((p) => p.node.id === "StaffActivityInvoke")!),
    ).toBe(
      "arn:aws:execute-api:eu-west-3:123456789012:review-api/$default/GET/restaurants/outlets/*/guest-activity",
    );
    expect(
      arn(permissions.find((p) => p.node.id === "StaffAcknowledgeInvoke")!),
    ).toBe(
      "arn:aws:execute-api:eu-west-3:123456789012:review-api/$default/POST/restaurants/outlets/*/waiter-calls/*/acknowledge",
    );
    expect(
      arn(permissions.find((p) => p.node.id === "StaffGuestRequestsInvoke")!),
    ).toBe(
      "arn:aws:execute-api:eu-west-3:123456789012:review-api/$default/*/restaurants/outlets/*/sessions/*/guest-requests*",
    );
    expect(publicArn).toBe(
      "arn:aws:execute-api:eu-west-3:123456789012:review-api/$default/*/public/restaurants/guest/*",
    );
    expect(staffArn).toBe(
      "arn:aws:execute-api:eu-west-3:123456789012:review-api/$default/*/restaurants/outlets/*/service-areas/*/tables/*/qr/*",
    );
    for (const permission of permissions) {
      expect(permission.principal).toBe("apigateway.amazonaws.com");
      expect(permission.action).toBe("lambda:InvokeFunction");
      expect(permission.sourceAccount).toBe("123456789012");
    }
    expect(
      cdk.Stack.of(publicPermission).resolve(publicPermission.functionName),
    ).not.toEqual(
      cdk.Stack.of(staffPermission).resolve(staffPermission.functionName),
    );
    const matches = (pattern: string, candidate: string) =>
      new RegExp(
        "^" +
          pattern
            .split("*")
            .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
            .join(".*") +
          "$",
      ).test(candidate);
    const routeArn = (method: string, path: string) =>
      `arn:aws:execute-api:eu-west-3:123456789012:review-api/$default/${method}${path}`;
    for (const route of constructs.filter(
      (item): item is apigwv2.CfnRoute => item instanceof apigwv2.CfnRoute,
    )) {
      const [method, path] = String(route.routeKey).split(" ");
      expect(matches(publicArn, routeArn(method, path))).toBe(
        path.startsWith("/public/restaurants/guest/"),
      );
      expect(matches(staffArn, routeArn(method, path))).toBe(
        path.endsWith("/qr/status") ||
          path.endsWith("/qr/rotate") ||
          path.endsWith("/qr/revoke"),
      );
    }
    for (const pattern of [publicArn, staffArn]) {
      expect(matches(pattern, pattern.replace("review-api", "other-api"))).toBe(
        false,
      );
      expect(
        matches(pattern, pattern.replace("/$default/", "/other-stage/")),
      ).toBe(false);
      expect(
        matches(
          pattern,
          routeArn("POST", "/restaurants/outlets/outlet/orders/order/close"),
        ),
      ).toBe(false);
    }
  });

  test("projects remaining frozen routes with reused integrations below the review threshold", () => {
    // Projection fixture only: these routes are never registered by the deployment app.
    const fixtureApp = new cdk.App({
      context: { authUseSecretsManager: true },
    });
    const fixture = new LiassOhadaBackendStack(fixtureApp, "Projection", {
      stage: "dev",
      env: { account: "123456789012", region: "eu-west-3" },
    });
    const all = fixture.node.findAll();
    const guest = all.find(
      (item): item is RestaurantsGuestEndpoints =>
        item instanceof RestaurantsGuestEndpoints,
    )!;
    const owner = cdk.Stack.of(guest);
    const before = Template.fromStack(
      constructs.find(
        (item) => item instanceof RestaurantsApiStack,
      ) as RestaurantsApiStack,
    ).toJSON();
    const firstStaff = guest.node
      .findAll()
      .find(
        (item): item is apigwv2.HttpRoute =>
          item instanceof apigwv2.HttpRoute &&
          String(
            (item.node.defaultChild as apigwv2.CfnRoute).routeKey,
          ).startsWith("GET /restaurants/"),
      )!;
    const staffCfn = firstStaff.node.defaultChild as apigwv2.CfnRoute;
    const httpApi = firstStaff.httpApi;
    const existingKeys = new Set(
      guest.node
        .findAll()
        .filter((x): x is apigwv2.CfnRoute => x instanceof apigwv2.CfnRoute)
        .map((x) => String(x.routeKey)),
    );
    for (const [index, [method, routePath]] of FROZEN_GUEST_ROUTES.entries()) {
      if (existingKeys.has(method + " " + routePath)) continue;
      const isPublic = routePath.startsWith("/public/");
      new apigwv2.HttpRoute(guest, `ProjectionRoute${index}`, {
        httpApi,
        routeKey: apigwv2.HttpRouteKey.with(
          routePath,
          method as apigwv2.HttpMethod,
        ),
        integration: isPublic
          ? guest.publicIntegration
          : guest.staffIntegration,
        authorizer: isPublic
          ? new apigwv2.HttpNoneAuthorizer()
          : {
              bind: () => ({
                authorizationType: apigwv2.HttpAuthorizerType.JWT,
                authorizerId: staffCfn.authorizerId!,
              }),
            },
      });
    }
    const staffFunction = guest.node
      .findAll()
      .find(
        (item): item is lambda.Function =>
          item instanceof lambda.Function &&
          (item.node.defaultChild as lambda.CfnFunction).functionName ===
            "liass-ohada-dev-restaurants-guest-qr-staff",
      )!;
    const futurePermissionPatterns = [
      "*/restaurants/outlets/*/service-areas/*/tables/*/qr/*",
      "GET/restaurants/outlets/*/guest-activity",
      "*/restaurants/outlets/*/sessions/*/guest-requests*",
      "POST/restaurants/outlets/*/waiter-calls/*/acknowledge",
    ];
    const matchesStaff = (method: string, routePath: string) =>
      futurePermissionPatterns.some((pattern) =>
        new RegExp(
          "^" +
            pattern
              .split("*")
              .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
              .join(".*") +
            "$",
        ).test(method + routePath),
      );
    for (const [method, routePath] of FROZEN_GUEST_ROUTES)
      expect(matchesStaff(method, routePath)).toBe(
        !routePath.startsWith("/public/"),
      );
    for (const item of constructs.filter(
      (item): item is apigwv2.CfnRoute => item instanceof apigwv2.CfnRoute,
    )) {
      const [method, path] = String(item.routeKey).split(" ");
      expect(matchesStaff(method, path)).toBe(
        path.endsWith("/qr/rotate") ||
          path.endsWith("/qr/revoke") ||
          path.endsWith("/qr/status") ||
          path.endsWith("/guest-activity") ||
          path.endsWith("/acknowledge") ||
          path.includes("/guest-requests"),
      );
    }
    expect(
      matchesStaff(
        "GET",
        "/restaurants/outlets/outlet/waiter-calls/call/acknowledge",
      ),
    ).toBe(false);
    for (const route of guest.node
      .findAll()
      .filter(
        (item): item is apigwv2.CfnRoute => item instanceof apigwv2.CfnRoute,
      )) {
      const publicRoute = String(route.routeKey).includes(" /public/");
      expect(route.authorizationType).toBe(publicRoute ? "NONE" : "JWT");
      if (!publicRoute) expect(route.authorizerId).toBe(staffCfn.authorizerId);
    }
    const after = Template.fromStack(owner).toJSON();
    expect(
      Object.keys(after.Resources).length -
        Object.keys(before.Resources).length,
    ).toBe(0);
    expect(Object.keys(after.Resources).length).toBeLessThanOrEqual(344);
    const typeCount = (template: typeof after, type: string) =>
      Object.values(template.Resources).filter(
        (r) => (r as { Type: string }).Type === type,
      ).length;
    expect(typeCount(after, "AWS::ApiGatewayV2::Integration")).toBe(
      typeCount(before, "AWS::ApiGatewayV2::Integration"),
    );
    expect(typeCount(after, "AWS::Lambda::Function")).toBe(
      typeCount(before, "AWS::Lambda::Function"),
    );
    for (const type of [
      "AWS::IAM::Role",
      "AWS::IAM::Policy",
      "AWS::SecretsManager::Secret",
    ])
      expect(typeCount(after, type)).toBe(typeCount(before, type));
  });
});
