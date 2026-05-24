import { handler } from "@/lambda/domains/core-ledger/books/get-general-ledger";
import { TenantAccessService } from "@/lambda/shared/services/tenant-access-service";
import {
  DynamoDBClient,
  GetItemCommand,
  QueryCommand,
} from "@aws-sdk/client-dynamodb";
import { mockClient } from "aws-sdk-client-mock";

const dynamoMock = mockClient(DynamoDBClient);

jest.mock("@/lambda/shared/services/tenant-access-service", () => ({
  TenantAccessService: {
    assertUserCanAccessOrg: jest.fn(),
  },
}));

const createEvent = (
  fiscalYear = "2026",
  accountId = "411",
  orgId = "test-org",
) => ({
  version: "2.0",
  routeKey: "POST /books/general-ledger",
  rawPath: "/books/general-ledger",
  rawQueryString: "",
  headers: { "accept-language": "en", "x-org-id": orgId },
  requestContext: {
    accountId: "123456789012",
    apiId: "api-id",
    domainName: "localhost",
    domainPrefix: "localhost",
    http: {
      method: "POST",
      path: "/books/general-ledger",
      protocol: "HTTP/1.1",
      sourceIp: "127.0.0.1",
      userAgent: "jest",
    },
    requestId: "req-id",
    routeKey: "POST /books/general-ledger",
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
  body: JSON.stringify({ fiscalYear, accountId }),
  isBase64Encoded: false,
});

const parseResponse = (response: any) => {
  if (typeof response === "string") {
    return JSON.parse(response);
  }
  return JSON.parse(response.body ?? "{}");
};

describe("get-general-ledger handler", () => {
  beforeEach(() => {
    dynamoMock.reset();
    jest.clearAllMocks();
    jest
      .mocked(TenantAccessService.assertUserCanAccessOrg)
      .mockResolvedValue({ role: "ACCOUNTANT" });
  });

  test("returns general ledger with opening balance and movements", async () => {
    // Mock GetItemCommand for account balance retrieval
    dynamoMock.on(GetItemCommand).resolves({
      Item: {
        PK: { S: "ORG#test-org#FY#2026" },
        SK: { S: "BAL#41100000" },
        accountId: { S: "41100000" },
        openingDebit: { N: "1000" },
        openingCredit: { N: "200" },
        movementDebit: { N: "500" },
        movementCredit: { N: "100" },
        updatedAt: { S: "2026-01-01T00:00:00Z" },
      },
    });

    // Mock QueryCommand for ledger entries
    dynamoMock.on(QueryCommand).resolves({
      Items: [
        {
          PK: { S: "ORG#test-org#FY#2026" },
          SK: { S: "L#L1" },
          entryId: { S: "E-001" },
          entryDate: { S: "2026-01-15" },
          journalCode: { S: "SALES" },
          debit: { N: "100" },
          credit: { N: "0" },
          description: { S: "Invoice to Client" },
          GSI1PK: { S: "ORG#test-org" },
          GSI1SK: { S: "ACC#41100000#FY#2026#DT#2026-01-15#L1" },
        },
        {
          PK: { S: "ORG#test-org#FY#2026" },
          SK: { S: "L#L2" },
          entryId: { S: "E-002" },
          entryDate: { S: "2026-01-20" },
          journalCode: { S: "SALES" },
          debit: { N: "50" },
          credit: { N: "0" },
          description: { S: "Payment received" },
          GSI1PK: { S: "ORG#test-org" },
          GSI1SK: { S: "ACC#41100000#FY#2026#DT#2026-01-20#L2" },
        },
      ],
    });

    const response = await handler(createEvent());
    const body = parseResponse(response);

    expect((response as any).statusCode).toBe(200);
    expect(body.message.code).toBe("SUCCESS_LEDGER_RETRIEVED");
    expect(body.data.accountId).toBe("41100000");

    // Verify opening balance
    expect(body.data.openingBalance.date).toBe("OPENING");
    expect(body.data.openingBalance.journal).toBe("RAN");
    expect(body.data.openingBalance.debit).toBe(1000);
    expect(body.data.openingBalance.credit).toBe(200);
    expect(body.data.openingBalance.runningBalance).toBe(800); // 1000 - 200

    // Verify movements
    expect(body.data.movements).toHaveLength(2);
    expect(body.data.movements[0].date).toBe("2026-01-15");
    expect(body.data.movements[0].debit).toBe(100);
    expect(body.data.movements[0].runningBalance).toBe(900); // 800 + 100

    expect(body.data.movements[1].date).toBe("2026-01-20");
    expect(body.data.movements[1].debit).toBe(50);
    expect(body.data.movements[1].runningBalance).toBe(950); // 900 + 50

    // Verify final balance
    expect(body.data.finalBalance).toBe(950);
  });

  test("returns 400 for invalid fiscal year format", async () => {
    const response = await handler(createEvent("26", "411"));
    const body = parseResponse(response);

    expect((response as any).statusCode).toBe(400);
    expect(body.message.code).toBe("ERROR_INVALID_INPUT");
  });

  test("returns 400 for invalid account ID format", async () => {
    const response = await handler(createEvent("2026", "4"));
    const body = parseResponse(response);

    expect((response as any).statusCode).toBe(400);
    expect(body.message.code).toBe("ERROR_INVALID_INPUT");
  });

  test("handles empty movements correctly (opening balance only)", async () => {
    dynamoMock.on(GetItemCommand).resolves({
      Item: {
        PK: { S: "ORG#test-org#FY#2026" },
        SK: { S: "BAL#41100000" },
        accountId: { S: "41100000" },
        openingDebit: { N: "500" },
        openingCredit: { N: "100" },
        movementDebit: { N: "0" },
        movementCredit: { N: "0" },
        updatedAt: { S: "2026-01-01T00:00:00Z" },
      },
    });

    dynamoMock.on(QueryCommand).resolves({
      Items: [],
    });

    const response = await handler(createEvent());
    const body = parseResponse(response);

    expect((response as any).statusCode).toBe(200);
    expect(body.data.movements).toHaveLength(0);
    expect(body.data.finalBalance).toBe(400); // 500 - 100
  });

  test("pads account ID to 8 digits", async () => {
    dynamoMock.on(GetItemCommand).resolves({
      Item: {
        PK: { S: "ORG#test-org#FY#2026" },
        SK: { S: "BAL#41000000" },
        accountId: { S: "41000000" },
        openingDebit: { N: "0" },
        openingCredit: { N: "0" },
        movementDebit: { N: "0" },
        movementCredit: { N: "0" },
        updatedAt: { S: "2026-01-01T00:00:00Z" },
      },
    });

    dynamoMock.on(QueryCommand).resolves({
      Items: [],
    });

    const response = await handler(createEvent("2026", "41"));
    const body = parseResponse(response);

    expect((response as any).statusCode).toBe(200);
    expect(body.data.accountId).toBe("41000000");
  });
});
