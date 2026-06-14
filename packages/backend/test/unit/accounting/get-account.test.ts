import { handler } from "@/lambda/domains/accounting/accounts/get-account";
import { TenantAccessService } from "@/lambda/shared/services/tenant-access-service";
import { DynamoDBClient, GetItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { mockClient } from "aws-sdk-client-mock";

const dynamoMock = mockClient(DynamoDBClient);

jest.mock("@/lambda/shared/services/tenant-access-service", () => ({
  TenantAccessService: {
    assertUserCanAccessOrg: jest.fn(),
  },
}));

const createEvent = (accountId = "411", orgId = "test-org") => {
  return {
    version: "2.0",
    routeKey: "GET /accounts/{accountId}",
    rawPath: `/accounts/${accountId}`,
    rawQueryString: "",
    headers: { "accept-language": "en", "x-org-id": orgId },
    requestContext: {
      accountId: "123456789012",
      apiId: "api-id",
      domainName: "localhost",
      domainPrefix: "localhost",
      http: {
        method: "GET",
        path: `/accounts/${accountId}`,
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "jest",
      },
      requestId: "req-id",
      routeKey: "GET /accounts/{accountId}",
      stage: "test",
      time: "01/Jan/1970:00:00:00 +0000",
      timeEpoch: 0,
      authorizer: {
        principalId: "user-123",
        integrationLatency: 0,
        jwt: {
          claims: { sub: "user-123" },
          scopes: [],
        },
      },
    },
    body: JSON.stringify({ accountId }),
    isBase64Encoded: false,
  };
};

const parseResponse = (response: any) => {
  if (typeof response === "string") {
    return JSON.parse(response);
  }
  return JSON.parse(response.body ?? "{}");
};

describe("get-account handler", () => {
  beforeEach(() => {
    dynamoMock.reset();
    jest.clearAllMocks();
    jest
      .mocked(TenantAccessService.assertUserCanAccessOrg)
      .mockResolvedValue({ role: "ACCOUNTANT" });
  });

  test("retrieves account successfully", async () => {
    const mockAccount = marshall({
      orgId: "test-org",
      accountId: "41100000",
      accountName: "Clients",
      accountNature: "BALANCE",
      accountUsage: "BOTH",
      isThirdPartyAccount: false,
      classCode: 4,
      financialStatementCode: "B01",
      allowReconciliation: true,
      entityType: "ACCOUNT",
      PK: "ORG#test-org",
      SK: "ACC#41100000",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    });

    dynamoMock.on(GetItemCommand).resolves({ Item: mockAccount });

    const response = await handler(createEvent("411"));
    const body = parseResponse(response);

    expect((response as any).statusCode).toBe(200);
    expect(body.message.code).toBe("SUCCESS_ACCOUNT_RETRIEVED");
    expect(body.account.accountId).toBe("41100000");
    expect(body.account.accountName).toBe("Clients");
    expect(body.account.PK).toBeUndefined();
    expect(body.account.SK).toBeUndefined();
  });

  test("returns 404 when account does not exist", async () => {
    dynamoMock.on(GetItemCommand).resolves({ Item: undefined });

    const response = await handler(createEvent("999"));
    const body = parseResponse(response);

    expect((response as any).statusCode).toBe(404);
    expect(body.message.code).toBe("ERROR_ACCOUNT_NOT_FOUND");
  });

  test("returns 400 for invalid input", async () => {
    const invalidEvent = createEvent("");
    invalidEvent.body = JSON.stringify({ accountId: "" });

    const response = await handler(invalidEvent);
    const body = parseResponse(response);

    expect((response as any).statusCode).toBe(400);
    expect(body.message.code).toBe("ERROR_INVALID_INPUT");
  });
});
