import { handler } from "@/lambda/domains/core-ledger/accounts/get-entries";
import { TenantAccessService } from "@/lambda/shared/services/tenant-access-service";
import {
  DynamoDBClient,
  GetItemCommand,
  QueryCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { mockClient } from "aws-sdk-client-mock";

const dynamoMock = mockClient(DynamoDBClient);

jest.mock("@/lambda/shared/services/tenant-access-service", () => ({
  TenantAccessService: {
    assertUserCanAccessOrg: jest.fn(),
  },
}));

const createEvent = (
  accountId = "411",
  fiscalYear = "2026",
  limit = "50",
  cursor = "",
  orgId = "test-org",
) => {
  return {
    version: "2.0",
    routeKey: "GET /accounts/{accountId}/entries",
    rawPath: `/accounts/${accountId}/entries`,
    rawQueryString: `limit=${limit}${cursor ? `&cursor=${cursor}` : ""}`,
    headers: { "accept-language": "en", "x-org-id": orgId },
    queryStringParameters: {
      limit,
      ...(cursor && { cursor }),
    },
    requestContext: {
      accountId: "123456789012",
      apiId: "api-id",
      domainName: "localhost",
      domainPrefix: "localhost",
      http: {
        method: "GET",
        path: `/accounts/${accountId}/entries`,
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "jest",
      },
      requestId: "req-id",
      routeKey: "GET /accounts/{accountId}/entries",
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
    body: JSON.stringify({
      accountId,
      fiscalYear,
      limit: parseInt(limit),
      cursor,
    }),
    isBase64Encoded: false,
  };
};

const parseResponse = (response: any) => {
  if (typeof response === "string") {
    return JSON.parse(response);
  }
  return JSON.parse(response.body ?? "{}");
};

describe("get-entries handler", () => {
  beforeEach(() => {
    dynamoMock.reset();
    jest.clearAllMocks();
    jest
      .mocked(TenantAccessService.assertUserCanAccessOrg)
      .mockResolvedValue({ role: "ACCOUNTANT" });
  });

  test("retrieves entries successfully with pagination", async () => {
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

    const mockEntries = [
      marshall({
        orgId: "test-org",
        year: 2026,
        lineId: "L1",
        entryId: "E-001",
        entryDate: "2026-01-15",
        journalCode: "SALES",
        voucherNumber: "INV-001",
        accountId: "41100000",
        debit: 100000,
        credit: 0,
        label: "Invoice to Client A",
        entityType: "ENTRY_LINE",
        PK: "ORG#test-org#FY#2026",
        SK: "L#L1",
        GSI1PK: "ORG#test-org",
        GSI1SK: "ACC#41100000#FY#2026#DT#2026-01-15#L1",
        createdAt: "2026-01-15T10:00:00Z",
        updatedAt: "2026-01-15T10:00:00Z",
      }),
    ];

    // Mock account lookup (GetItemCommand)
    dynamoMock.on(GetItemCommand).resolves({ Item: mockAccount });
    // Mock entries query (QueryCommand)
    dynamoMock.on(QueryCommand).resolves({
      Items: mockEntries,
      LastEvaluatedKey: undefined,
    });

    const response = await handler(createEvent("411", "2026", "50"));
    const body = parseResponse(response);

    expect((response as any).statusCode).toBe(200);
    expect(body.message.code).toBe("SUCCESS_ENTRIES_RETRIEVED");
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].accountId).toBe("41100000");
    expect(body.entries[0].debit).toBe(100000);
    expect(body.hasMore).toBe(false);
  });

  test("returns 404 when account does not exist", async () => {
    dynamoMock.on(GetItemCommand).resolves({ Item: undefined });

    const response = await handler(createEvent("999"));
    const body = parseResponse(response);

    expect((response as any).statusCode).toBe(404);
    expect(body.message.code).toBe("ERROR_ACCOUNT_NOT_FOUND");
  });

  test("returns 400 for invalid input (missing accountId)", async () => {
    const invalidEvent = createEvent("");
    invalidEvent.body = JSON.stringify({
      accountId: "",
      fiscalYear: "2026",
    });

    const response = await handler(invalidEvent);
    const body = parseResponse(response);

    expect((response as any).statusCode).toBe(400);
    expect(body.message.code).toBe("ERROR_INVALID_INPUT");
  });

  test("handles pagination cursor correctly", async () => {
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

    const nextKey = Buffer.from(
      JSON.stringify({ PK: "ORG#test-org#FY#2026", SK: "L#L100" }),
    ).toString("base64");

    dynamoMock.on(GetItemCommand).resolves({ Item: mockAccount });
    dynamoMock.on(QueryCommand).resolves({
      Items: [],
      LastEvaluatedKey: marshall({ PK: "ORG#test-org#FY#2026", SK: "L#L100" }),
    });

    const response = await handler(createEvent("411", "2026", "50", nextKey));
    const body = parseResponse(response);

    expect((response as any).statusCode).toBe(200);
    expect(body.hasMore).toBe(true);
    expect(body.nextCursor).toBeDefined();
  });
});
