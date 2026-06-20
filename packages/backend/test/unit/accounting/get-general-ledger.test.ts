import { handler } from "@/lambda/domains/accounting/books/get-general-ledger";
import { TenantAccessService } from "@/lambda/shared/services/tenant-access-service";
import {
  DynamoDBClient,
  GetItemCommand,
  QueryCommand,
  ScanCommand,
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
  fiscalYear = "2026",
  accountId = "411",
  orgId = "test-org",
  options?: {
    limit?: number;
    cursor?: string;
    startDate?: string;
    endDate?: string;
  },
) => ({
  version: "2.0",
  routeKey: "GET /books/general-ledger",
  rawPath: "/books/general-ledger",
  rawQueryString: "",
  queryStringParameters: {
    fiscalYear,
    accountId,
    ...(options?.limit ? { limit: options.limit.toString() } : {}),
    ...(options?.cursor ? { cursor: options.cursor } : {}),
    ...(options?.startDate ? { startDate: options.startDate } : {}),
    ...(options?.endDate ? { endDate: options.endDate } : {}),
  },
  headers: { "accept-language": "en", "x-org-id": orgId },
  requestContext: {
    accountId: "123456789012",
    apiId: "api-id",
    domainName: "localhost",
    domainPrefix: "localhost",
    http: {
      method: "GET",
      path: "/books/general-ledger",
      protocol: "HTTP/1.1",
      sourceIp: "127.0.0.1",
      userAgent: "jest",
    },
    requestId: "req-id",
    routeKey: "GET /books/general-ledger",
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
        movementDebit: { N: "150" },
        movementCredit: { N: "0" },
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
    expect(body.data.openingBalance.debit).toBe(1000);
    expect(body.data.openingBalance.credit).toBe(200);
    expect(body.data.openingBalance.balance).toBe(800); // 1000 - 200
    expect(body.data.openingBalance.journalCode).toBeUndefined();
    expect(body.data.openingBalance.reference).toBeUndefined();

    // Verify movements
    expect(body.data.movements).toHaveLength(2);
    expect(body.data.movements[0].date).toBe("2026-01-15");
    expect(body.data.movements[0].journalCode).toBe("SALES");
    expect(body.data.movements[0].lineId).toBeUndefined();
    expect(body.data.movements[0].debit).toBe(100);
    expect(body.data.movements[0].runningBalance).toBe(900); // 800 + 100

    expect(body.data.movements[1].date).toBe("2026-01-20");
    expect(body.data.movements[1].debit).toBe(50);
    expect(body.data.movements[1].runningBalance).toBe(950); // 900 + 50

    // Verify final balance
    expect(body.data.finalBalance).toBe(950);
    expect(body.data.hasMore).toBe(false);
    expect(body.data.PK).toBeUndefined();

    const queryInput = dynamoMock.commandCalls(QueryCommand)[0].args[0].input;
    expect(queryInput.IndexName).toBe("GSI1");
    expect(queryInput.ConsistentRead).toBeUndefined();
    expect(dynamoMock.commandCalls(ScanCommand)).toHaveLength(0);
  });

  test("paginates movements and carries the running balance forward", async () => {
    dynamoMock.on(GetItemCommand).resolves({
      Item: {
        accountId: { S: "41100000" },
        openingDebit: { N: "1000" },
        openingCredit: { N: "0" },
        movementDebit: { N: "150" },
        movementCredit: { N: "0" },
        updatedAt: { S: "2026-01-01T00:00:00Z" },
      },
    });

    const lastEvaluatedKey = {
      GSI1PK: { S: "ORG#test-org" },
      GSI1SK: {
        S: "ACC#41100000#FY#2026#DT#2026-01-15#L1",
      },
      PK: { S: "ORG#test-org#FY#2026" },
      SK: { S: "L#L1" },
    };

    dynamoMock
      .on(QueryCommand)
      .resolvesOnce({
        Items: [
          {
            entryId: { S: "E-001" },
            lineId: { S: "L1" },
            entryDate: { S: "2026-01-15" },
            journalCode: { S: "VE" },
            debit: { N: "100" },
            credit: { N: "0" },
          },
        ],
        LastEvaluatedKey: lastEvaluatedKey,
      })
      .resolvesOnce({
        Items: [
          {
            entryId: { S: "E-002" },
            lineId: { S: "L2" },
            entryDate: { S: "2026-01-20" },
            journalCode: { S: "VE" },
            debit: { N: "50" },
            credit: { N: "0" },
          },
        ],
      });

    const firstResponse = parseResponse(
      await handler(createEvent("2026", "411", "test-org", { limit: 1 })),
    );
    expect(firstResponse.data.movements[0].runningBalance).toBe(1100);
    expect(firstResponse.data.hasMore).toBe(true);

    const secondResponse = parseResponse(
      await handler(
        createEvent("2026", "411", "test-org", {
          limit: 1,
          cursor: firstResponse.data.nextCursor,
        }),
      ),
    );
    expect(secondResponse.data.movements[0].runningBalance).toBe(1150);
    expect(secondResponse.data.hasMore).toBe(false);

    const secondQueryInput =
      dynamoMock.commandCalls(QueryCommand)[1].args[0].input;
    expect(secondQueryInput.ExclusiveStartKey).toEqual(lastEvaluatedKey);
    expect(secondQueryInput.ConsistentRead).toBeUndefined();
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
    expect(body.data.hasMore).toBe(false);
  });

  test("preserves a selected period and derives its opening balance from daily aggregates", async () => {
    dynamoMock
      .on(GetItemCommand)
      .resolvesOnce({
        Item: marshall({
          orgId: "test-org",
          year: 2026,
          fiscalYearId: "FY-2026",
          startDate: "2026-01-01",
          endDate: "2026-12-31",
          status: "OPEN",
          accountingFramework: "SYSCOHADA_REVISED",
          entityType: "FISCAL_YEAR",
          PK: "ORG#test-org",
          SK: "FY#2026",
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
        }),
      })
      .resolvesOnce({
        Item: marshall({
          accountId: "41100000",
          openingDebit: 100,
          openingCredit: 0,
          movementDebit: 80,
          movementCredit: 30,
          dailyDebit_2026_01_10: 50,
          dailyCredit_2026_02_01: 10,
          dailyDebit_2026_02_28: 30,
          dailyCredit_2026_03_01: 20,
        }),
      });
    dynamoMock.on(QueryCommand).resolves({
      Items: [
        marshall({
          entryId: "E-001",
          lineId: "L1",
          entryDate: "2026-02-01",
          journalCode: "VE",
          debit: 0,
          credit: 10,
        }),
        marshall({
          entryId: "E-002",
          lineId: "L2",
          entryDate: "2026-02-28",
          journalCode: "VE",
          debit: 30,
          credit: 0,
        }),
      ],
    });

    const response = await handler(
      createEvent("2026", "411", "test-org", {
        startDate: "2026-02-01",
        endDate: "2026-02-28",
      }),
    );
    const body = parseResponse(response);

    expect(response.statusCode).toBe(200);
    expect(body.data.openingBalance.balance).toBe(150);
    expect(body.data.movements[0].runningBalance).toBe(140);
    expect(body.data.movements[1].runningBalance).toBe(170);
    expect(body.data.finalBalance).toBe(170);
    const query = dynamoMock.commandCalls(QueryCommand)[0].args[0].input;
    expect(query.KeyConditionExpression).toContain("BETWEEN");
    expect(query.ConsistentRead).toBeUndefined();
  });

  test("returns a zero opening balance and explicit hasMore when no aggregate exists", async () => {
    dynamoMock.on(GetItemCommand).resolves({ Item: undefined });
    dynamoMock.on(QueryCommand).resolves({ Items: [] });

    const response = await handler(createEvent());
    const body = parseResponse(response);

    expect((response as any).statusCode).toBe(200);
    expect(body.data.openingBalance).toEqual({
      debit: 0,
      credit: 0,
      balance: 0,
    });
    expect(body.data.movements).toEqual([]);
    expect(body.data.hasMore).toBe(false);
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
