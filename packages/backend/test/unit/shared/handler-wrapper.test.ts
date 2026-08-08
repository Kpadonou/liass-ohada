import { DynamoDBClient, GetItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { z } from "zod";
import {
  createAuthenticatedHandler,
  createHandler,
  createPlatformHandler,
} from "@/lambda/shared/middleware/handler-wrapper";
import { AppError } from "@/lambda/shared/app-error";
import { AccountingAuthorizationService } from "@/lambda/shared/services/accounting-authorization-service";
import { DomainAuthorizationService } from "@/lambda/shared/services/domain-authorization-service";
import { ProductAccessService } from "@/lambda/shared/services/product-access-service";

const dynamoMock = mockClient(DynamoDBClient);

const createEvent = ({
  body = {},
  headers = { "accept-language": "en", "x-org-id": "test-org" },
  claims = { sub: "user-123" },
}: {
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
  claims?: Record<string, string>;
} = {}) => ({
  version: "2.0",
  routeKey: "POST /test",
  rawPath: "/test",
  rawQueryString: "",
  headers,
  requestContext: {
    accountId: "123456789012",
    apiId: "api-id",
    domainName: "localhost",
    domainPrefix: "localhost",
    http: {
      method: "POST",
      path: "/test",
      protocol: "HTTP/1.1",
      sourceIp: "127.0.0.1",
      userAgent: "jest",
    },
    requestId: "req-id",
    routeKey: "POST /test",
    stage: "test",
    time: "01/Jan/1970:00:00:00 +0000",
    timeEpoch: 0,
    authorizer: {
      jwt: {
        claims,
        scopes: [],
      },
    },
  },
  body: JSON.stringify(body),
  isBase64Encoded: false,
});

describe("handler-wrapper auth context", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    dynamoMock.reset();
    jest.clearAllMocks();
  });

  test("passes resolved user and organization context after active access check", async () => {
    dynamoMock.on(GetItemCommand).resolves({
      Item: marshall({
        PK: "ORG#test-org",
        SK: "USER#user-123",
        entityType: "USER_ORG_ACCESS",
        orgId: "test-org",
        userId: "user-123",
        role: "ACCOUNTANT",
        status: "ACTIVE",
        cabinetId: "cab-001",
        accessSource: "DIRECT",
        workspaceType: "COMPANY",
      }),
    });

    const logic = jest.fn().mockResolvedValue({ ok: true });
    const handler = createHandler(z.object({}), logic);

    const response = await handler(createEvent() as any);
    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(logic).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        orgId: "test-org",
        userId: "user-123",
        role: "ACCOUNTANT",
        cabinetId: "cab-001",
      }),
    );
  });

  test("rejects requests without Cognito subject", async () => {
    const handler = createHandler(z.object({}), jest.fn());

    const response = await handler(createEvent({ claims: {} }) as any);
    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(401);
    expect(body.message.code).toBe("ERROR_MISSING_USER_ID");
  });

  test("rejects requests without active organization header", async () => {
    const handler = createHandler(z.object({}), jest.fn());

    const response = await handler(
      createEvent({ headers: { "accept-language": "en" } }) as any,
    );
    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(400);
    expect(body.message.code).toBe("ERROR_MISSING_ORG_ID");
  });

  test("rejects requests without active organization access", async () => {
    dynamoMock.on(GetItemCommand).resolves({ Item: undefined });
    const handler = createHandler(z.object({}), jest.fn());

    const response = await handler(createEvent() as any);
    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(403);
    expect(body.message.code).toBe("ERROR_ORG_ACCESS_DENIED");
  });

  test("strips tenant identifiers from request data", async () => {
    dynamoMock.on(GetItemCommand).resolves({
      Item: marshall({
        PK: "ORG#test-org",
        SK: "USER#user-123",
        entityType: "USER_ORG_ACCESS",
        orgId: "test-org",
        userId: "user-123",
        role: "ACCOUNTANT",
        status: "ACTIVE",
        accessSource: "DIRECT",
        workspaceType: "COMPANY",
      }),
    });

    const logic = jest.fn().mockResolvedValue({ ok: true });
    const handler = createHandler(z.object({ orgId: z.string().optional() }), logic);

    const response = await handler(
      createEvent({ body: { orgId: "attacker-org" } }) as any,
    );

    expect(response.statusCode).toBe(200);
    expect(logic).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ orgId: "test-org" }),
    );
  });

  test("rejects an accounting-firm organization for accounting handlers", async () => {
    dynamoMock.on(GetItemCommand).resolves({
      Item: marshall({
        PK: "ORG#cabinet-org",
        SK: "USER#user-123",
        entityType: "USER_ORG_ACCESS",
        orgId: "cabinet-org",
        userId: "user-123",
        role: "OWNER",
        status: "ACTIVE",
        accessSource: "DIRECT",
        workspaceType: "ACCOUNTING_FIRM",
      }),
    });
    const logic = jest.fn();
    const handler = createHandler(z.object({}), logic);

    const response = await handler(
      createEvent({
        headers: { "accept-language": "en", "x-org-id": "cabinet-org" },
      }) as any,
    );
    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(403);
    expect(body.message.code).toBe("ERROR_ACCOUNTING_DOSSIER_REQUIRED");
    expect(logic).not.toHaveBeenCalled();
  });

  test("authenticated handler accepts Cognito subject without organization header", async () => {
    const logic = jest.fn().mockResolvedValue({ ok: true });
    const handler = createAuthenticatedHandler(z.object({}), logic);

    const response = await handler(
      createEvent({ headers: { "accept-language": "en" } }) as any,
    );
    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(logic).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ userId: "user-123" }),
    );
  });

  test("authenticated handler rejects requests without Cognito subject", async () => {
    const handler = createAuthenticatedHandler(z.object({}), jest.fn());

    const response = await handler(createEvent({ claims: {} }) as any);
    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(401);
    expect(body.message.code).toBe("ERROR_MISSING_USER_ID");
  });

  test("orders annotated authorization as membership, ProductAccess, then permission", async () => {
    const membership = jest
      .spyOn(AccountingAuthorizationService, "resolveAccess")
      .mockResolvedValue({
        accessMode: "READ_WRITE",
        accessSource: "DIRECT",
        orgId: "test-org",
        workspaceOrgId: "test-org",
      });
    const product = jest
      .spyOn(ProductAccessService, "requireActiveProductAccess")
      .mockResolvedValue({
        orgId: "test-org",
        productCode: "TREASURY",
        status: "ACTIVE",
        createdAt: "2026-08-07T10:00:00.000Z",
        updatedAt: "2026-08-07T10:00:00.000Z",
      });
    const permission = jest.spyOn(DomainAuthorizationService, "assertPermission");
    const logic = jest.fn().mockResolvedValue({ ok: true });
    const handler = createHandler(z.object({}), logic, {
      action: "GET /treasury/summary",
      permission: "TREASURY_READ",
      productCode: "TREASURY",
    });

    const response = await handler(createEvent() as any);

    expect(response.statusCode).toBe(200);
    expect(membership).toHaveBeenCalled();
    expect(product).toHaveBeenCalledWith({
      action: "GET /treasury/summary",
      orgId: "test-org",
      productCode: "TREASURY",
    });
    expect(permission).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "test-org" }),
      "TREASURY_READ",
    );
    expect(membership.mock.invocationCallOrder[0]).toBeLessThan(
      product.mock.invocationCallOrder[0],
    );
    expect(product.mock.invocationCallOrder[0]).toBeLessThan(
      permission.mock.invocationCallOrder[0],
    );
    expect(logic).toHaveBeenCalled();
  });

  test("does not check ProductAccess before successful membership", async () => {
    jest
      .spyOn(AccountingAuthorizationService, "resolveAccess")
      .mockRejectedValue(new AppError(403, "ERROR_ORG_ACCESS_DENIED"));
    const product = jest.spyOn(
      ProductAccessService,
      "requireActiveProductAccess",
    );
    const handler = createHandler(z.object({}), jest.fn(), {
      action: "GET /treasury/summary",
      permission: "TREASURY_READ",
      productCode: "TREASURY",
    });

    const response = await handler(createEvent() as any);

    expect(response.statusCode).toBe(403);
    expect(product).not.toHaveBeenCalled();
  });

  test("does not check ProductAccess for an unauthenticated annotated request", async () => {
    const product = jest.spyOn(
      ProductAccessService,
      "requireActiveProductAccess",
    );
    const handler = createHandler(z.object({}), jest.fn(), {
      action: "GET /treasury/summary",
      permission: "TREASURY_READ",
      productCode: "TREASURY",
    });

    const response = await handler(createEvent({ claims: {} }) as any);

    expect(response.statusCode).toBe(401);
    expect(product).not.toHaveBeenCalled();
  });

  test("denies an annotated route when ProductAccess is missing", async () => {
    jest
      .spyOn(AccountingAuthorizationService, "resolveAccess")
      .mockResolvedValue({
        accessMode: "READ_WRITE",
        accessSource: "DIRECT",
        orgId: "test-org",
        workspaceOrgId: "test-org",
      });
    jest
      .spyOn(ProductAccessService, "requireActiveProductAccess")
      .mockRejectedValue(new AppError(403, "PRODUCT_ACCESS_REQUIRED"));
    const permission = jest.spyOn(DomainAuthorizationService, "assertPermission");
    const logic = jest.fn();
    const handler = createHandler(z.object({}), logic, {
      action: "GET /treasury/summary",
      permission: "TREASURY_READ",
      productCode: "TREASURY",
    });

    const response = await handler(createEvent() as any);
    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(403);
    expect(body.error.code).toBe("PRODUCT_ACCESS_REQUIRED");
    expect(permission).not.toHaveBeenCalled();
    expect(logic).not.toHaveBeenCalled();
  });

  test("checks ProductAccess before rejecting insufficient domain permission", async () => {
    jest
      .spyOn(AccountingAuthorizationService, "resolveAccess")
      .mockResolvedValue({
        accessMode: "READ_ONLY",
        accessSource: "CABINET",
        orgId: "test-org",
        workspaceOrgId: "cabinet-org",
      });
    const product = jest
      .spyOn(ProductAccessService, "requireActiveProductAccess")
      .mockResolvedValue({
        orgId: "test-org",
        productCode: "TREASURY",
        status: "ACTIVE",
        createdAt: "2026-08-07T10:00:00.000Z",
        updatedAt: "2026-08-07T10:00:00.000Z",
      });
    const logic = jest.fn();
    const handler = createHandler(z.object({}), logic, {
      action: "GET /treasury/summary",
      permission: "TREASURY_WRITE",
      productCode: "TREASURY",
    });

    const response = await handler(createEvent() as any);
    const body = JSON.parse(response.body);

    expect(product).toHaveBeenCalled();
    expect(response.statusCode).toBe(403);
    expect(body.error.code).toBe("CABINET_DOSSIER_READ_ONLY");
    expect(logic).not.toHaveBeenCalled();
  });

  test("lets explicit permission metadata override the Accounting fallback", async () => {
    const originalPermission = process.env.ACCOUNTING_PERMISSION;
    process.env.ACCOUNTING_PERMISSION = "ACCOUNTING_WRITE";
    const membership = jest
      .spyOn(AccountingAuthorizationService, "resolveAccess")
      .mockResolvedValue({
        accessMode: "READ_WRITE",
        accessSource: "DIRECT",
        orgId: "test-org",
        permissions: ["PROJECTS_READ"],
        workspaceOrgId: "test-org",
      });
    const product = jest.spyOn(
      ProductAccessService,
      "requireActiveProductAccess",
    );
    const permission = jest.spyOn(DomainAuthorizationService, "assertPermission");
    const logic = jest.fn().mockResolvedValue({ ok: true });
    const handler = createHandler(z.object({}), logic, {
      permission: "PROJECTS_READ",
    });

    const response = await handler(createEvent() as any);

    expect(response.statusCode).toBe(200);
    expect(product).not.toHaveBeenCalled();
    expect(permission).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "test-org" }),
      "PROJECTS_READ",
    );
    expect(membership.mock.invocationCallOrder[0]).toBeLessThan(
      permission.mock.invocationCallOrder[0],
    );
    expect(permission.mock.invocationCallOrder[0]).toBeLessThan(
      logic.mock.invocationCallOrder[0],
    );
    process.env.ACCOUNTING_PERMISSION = originalPermission;
  });

  test("preserves the Accounting permission environment fallback", async () => {
    const originalPermission = process.env.ACCOUNTING_PERMISSION;
    process.env.ACCOUNTING_PERMISSION = "ACCOUNTING_READ";
    jest
      .spyOn(AccountingAuthorizationService, "resolveAccess")
      .mockResolvedValue({
        accessMode: "READ_WRITE",
        accessSource: "DIRECT",
        orgId: "test-org",
        permissions: ["ACCOUNTING_READ"],
        workspaceOrgId: "test-org",
      });
    const product = jest.spyOn(
      ProductAccessService,
      "requireActiveProductAccess",
    );
    const permission = jest.spyOn(DomainAuthorizationService, "assertPermission");
    const logic = jest.fn().mockResolvedValue({ ok: true });

    const response = await createHandler(z.object({}), logic)(
      createEvent() as any,
    );

    expect(response.statusCode).toBe(200);
    expect(product).not.toHaveBeenCalled();
    expect(permission).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "test-org" }),
      "ACCOUNTING_READ",
    );
    expect(logic).toHaveBeenCalled();
    process.env.ACCOUNTING_PERMISSION = originalPermission;
  });

  test("keeps permission-only metadata exact across domains", async () => {
    jest
      .spyOn(AccountingAuthorizationService, "resolveAccess")
      .mockResolvedValue({
        accessMode: "READ_WRITE",
        accessSource: "DIRECT",
        orgId: "test-org",
        permissions: ["TREASURY_READ"],
        workspaceOrgId: "test-org",
      });
    const product = jest.spyOn(
      ProductAccessService,
      "requireActiveProductAccess",
    );
    const logic = jest.fn();
    const handler = createHandler(z.object({}), logic, {
      permission: "PROJECTS_READ",
    });

    const response = await handler(createEvent() as any);

    expect(response.statusCode).toBe(403);
    expect(JSON.parse(response.body).error.code).toBe(
      "DOMAIN_PERMISSION_REQUIRED",
    );
    expect(product).not.toHaveBeenCalled();
    expect(logic).not.toHaveBeenCalled();
  });

  test("leaves unannotated and Platform Core routes non-enforcing", async () => {
    jest
      .spyOn(AccountingAuthorizationService, "resolveAccess")
      .mockResolvedValue({
        accessMode: "READ_WRITE",
        accessSource: "DIRECT",
        orgId: "test-org",
        workspaceOrgId: "test-org",
      });
    const product = jest.spyOn(
      ProductAccessService,
      "requireActiveProductAccess",
    );
    const tenantLogic = jest.fn().mockResolvedValue({ ok: true });
    const platformLogic = jest.fn().mockResolvedValue({ ok: true });

    const tenantResponse = await createHandler(z.object({}), tenantLogic)(
      createEvent() as any,
    );
    dynamoMock.on(GetItemCommand).resolves({
      Item: marshall({
        PK: "ORG#test-org",
        SK: "USER#user-123",
        entityType: "USER_ORG_ACCESS",
        orgId: "test-org",
        userId: "user-123",
        role: "ACCOUNTANT",
        status: "ACTIVE",
        workspaceType: "COMPANY",
      }),
    });
    const platformResponse = await createPlatformHandler(
      z.object({}),
      platformLogic,
    )(createEvent() as any);

    expect(tenantResponse.statusCode).toBe(200);
    expect(platformResponse.statusCode).toBe(200);
    expect(product).not.toHaveBeenCalled();
  });
});
