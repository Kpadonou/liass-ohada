import * as cdk from "aws-cdk-lib";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";
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

  test("owns all 70 configuration, transactional and staff restaurant routes in one domain stack", () => {
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
    expect(functions).toHaveLength(70);
    expect(routes).toHaveLength(70);
    expect(
      owned.filter((item) => item instanceof apigwv2.CfnIntegration),
    ).toHaveLength(70);
    expect(
      owned.filter((item) => item instanceof lambda.CfnPermission),
    ).toHaveLength(70);
    expect(routes.every((route) => route.authorizationType === "JWT")).toBe(
      true,
    );
    expect(
      routes.every((route) =>
        String(route.routeKey).includes(" /restaurants/"),
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
    for (const fn of functions)
      expect(cdk.Stack.of(fn).resolve(fn.role)).toEqual(
        cdk.Stack.of(fn).resolve(executionRole.roleArn),
      );
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
});
