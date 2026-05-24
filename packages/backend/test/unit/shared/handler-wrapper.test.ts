import { DynamoDBClient, GetItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { z } from "zod";
import {
  createAuthenticatedHandler,
  createHandler,
} from "@/lambda/shared/middleware/handler-wrapper";

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
});
