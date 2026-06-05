import { handler } from "@/lambda/domains/accounting/books/get-trial-balance";
import { TenantAccessService } from "@/lambda/shared/services/tenant-access-service";
import { DynamoDBClient, QueryCommand } from "@aws-sdk/client-dynamodb";
import { mockClient } from "aws-sdk-client-mock";

const dynamoMock = mockClient(DynamoDBClient);

jest.mock("@/lambda/shared/services/tenant-access-service", () => ({
  TenantAccessService: {
    assertUserCanAccessOrg: jest.fn(),
  },
}));

const createEvent = (year = "2026", orgId = "test-org") => ({
  version: "2.0",
  routeKey: "POST /books/trial-balance",
  rawPath: "/books/trial-balance",
  rawQueryString: "",
  headers: { "accept-language": "en", "x-org-id": orgId },
  requestContext: {
    accountId: "123456789012",
    apiId: "api-id",
    domainName: "localhost",
    domainPrefix: "localhost",
    http: {
      method: "POST",
      path: "/books/trial-balance",
      protocol: "HTTP/1.1",
      sourceIp: "127.0.0.1",
      userAgent: "jest",
    },
    requestId: "req-id",
    routeKey: "POST /books/trial-balance",
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
  body: JSON.stringify({ year }),
  isBase64Encoded: false,
});

const parseResponse = (response: any) => {
  if (typeof response === "string") {
    return JSON.parse(response);
  }
  return JSON.parse(response.body ?? "{}");
};

describe("get-trial-balance handler", () => {
  beforeEach(() => {
    dynamoMock.reset();
    jest.clearAllMocks();
    jest
      .mocked(TenantAccessService.assertUserCanAccessOrg)
      .mockResolvedValue({ role: "ACCOUNTANT" });
  });

  test("returns correct 6-column trial balance and grand totals", async () => {
    dynamoMock.on(QueryCommand).resolves({
      Items: [
        {
          PK: { S: "ORG#test-org#FY#2026" },
          SK: { S: "BAL#41100000" },
          accountId: { S: "41100000" },
          openingDebit: { N: "100" },
          openingCredit: { N: "20" },
          movementDebit: { N: "50" },
          movementCredit: { N: "30" },
          updatedAt: { S: "2026-01-01T00:00:00Z" },
        },
        {
          PK: { S: "ORG#test-org#FY#2026" },
          SK: { S: "BAL#51200000" },
          accountId: { S: "51200000" },
          openingDebit: { N: "0" },
          openingCredit: { N: "0" },
          movementDebit: { N: "10" },
          movementCredit: { N: "40" },
          updatedAt: { S: "2026-01-01T00:00:00Z" },
        },
      ],
    });

    const response = await handler(createEvent());
    const body = parseResponse(response);

    expect((response as any).statusCode).toBe(200);
    expect(body.message.code).toBe("SUCCESS_TRIAL_BALANCE_RETRIEVED");
    expect(body.data.rows).toHaveLength(2);
    expect(body.data.rows[0].accountId).toBe("41100000");
    expect(body.data.rows[1].accountId).toBe("51200000");

    // row 1 final: (100+50)-(20+30)=100 -> debit
    expect(body.data.rows[0].finalDebit).toBe(100);
    expect(body.data.rows[0].finalCredit).toBe(0);

    // row 2 final: (0+10)-(0+40)=-30 -> credit
    expect(body.data.rows[1].finalDebit).toBe(0);
    expect(body.data.rows[1].finalCredit).toBe(30);

    expect(body.data.totals).toEqual({
      openingDebit: 100,
      openingCredit: 20,
      movementDebit: 60,
      movementCredit: 70,
      finalDebit: 100,
      finalCredit: 30,
    });
  });

  test("returns 400 for invalid year input", async () => {
    const response = await handler(createEvent(""));
    const body = parseResponse(response);

    expect((response as any).statusCode).toBe(400);
    expect(body.message.code).toBe("ERROR_INVALID_INPUT");
  });
});
