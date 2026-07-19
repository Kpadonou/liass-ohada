import { handler } from "@/lambda/domains/accounting/books/get-trial-balance";
import { TenantAccessService } from "@/lambda/shared/services/tenant-access-service";
import {
  BatchGetItemCommand,
  DynamoDBClient,
  GetItemCommand,
  QueryCommand,
  ScanCommand,
} from "@aws-sdk/client-dynamodb";
import { mockClient } from "aws-sdk-client-mock";

const dynamoMock = mockClient(DynamoDBClient);

jest.mock("@/lambda/shared/services/tenant-access-service", () => ({
  TenantAccessService: {
    assertUserCanAccessOrg: jest.fn(),
  },
}));

const createEvent = (
  overrides: Record<string, string> = {},
  orgId = "test-org",
) => ({
  version: "2.0",
  routeKey: "GET /books/trial-balance",
  rawPath: "/books/trial-balance",
  rawQueryString: "",
  queryStringParameters: {
    year: "2026",
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    ...overrides,
  },
  headers: { "accept-language": "en", "x-org-id": orgId },
  requestContext: {
    http: { method: "GET", path: "/books/trial-balance" },
    authorizer: { jwt: { claims: { sub: "user-123" }, scopes: [] } },
  },
  isBase64Encoded: false,
});

const parseResponse = (response: any) =>
  JSON.parse(typeof response === "string" ? response : response.body ?? "{}");

const fiscalYearItem = {
  PK: { S: "ORG#test-org" },
  SK: { S: "FY#2026" },
  orgId: { S: "test-org" },
  year: { N: "2026" },
  fiscalYearId: { S: "FY-2026" },
  startDate: { S: "2026-01-01" },
  endDate: { S: "2026-12-31" },
  status: { S: "OPEN" },
  accountingFramework: { S: "SYSCOHADA_REVISED" },
  entityType: { S: "FISCAL_YEAR" },
  createdAt: { S: "2026-01-01T00:00:00.000Z" },
  updatedAt: { S: "2026-01-01T00:00:00.000Z" },
};

describe("get-trial-balance handler", () => {
  beforeEach(() => {
    dynamoMock.reset();
    jest.clearAllMocks();
    jest
      .mocked(TenantAccessService.assertUserCanAccessOrg)
      .mockResolvedValue({ role: "ACCOUNTANT", workspaceType: "COMPANY" });
    dynamoMock.on(GetItemCommand).resolves({ Item: fiscalYearItem });
    dynamoMock.on(BatchGetItemCommand).resolves({
      Responses: {
        "liass-ohada-test-accounting-table": [
          {
            accountId: { S: "40110000" },
            accountName: { S: "Fournisseurs" },
          },
          {
            accountId: { S: "51200000" },
            accountName: { S: "Banque" },
          },
        ],
      },
    });
  });

  test("returns labelled, sorted six-column rows and global balance controls", async () => {
    dynamoMock.on(QueryCommand).resolves({
      Items: [
        {
          accountId: { S: "51200000" },
          openingDebit: { N: "0" },
          openingCredit: { N: "100" },
          movementDebit: { N: "100" },
          movementCredit: { N: "0" },
        },
        {
          PK: { S: "ORG#test-org#FY#2026" },
          SK: { S: "BAL#40110000" },
          entityType: { S: "ACCOUNT_BALANCE" },
          accountId: { S: "40110000" },
          openingDebit: { N: "100" },
          openingCredit: { N: "0" },
          movementDebit: { N: "0" },
          movementCredit: { N: "100" },
        },
      ],
    });

    const response = await handler(createEvent());
    const body = parseResponse(response);

    expect(response.statusCode).toBe(200);
    expect(body.data.rows).toEqual([
      {
        accountCode: "40110000",
        accountLabel: "Fournisseurs",
        openingDebit: 100,
        openingCredit: 0,
        movementDebit: 0,
        movementCredit: 100,
        closingDebit: 0,
        closingCredit: 0,
      },
      {
        accountCode: "51200000",
        accountLabel: "Banque",
        openingDebit: 0,
        openingCredit: 100,
        movementDebit: 100,
        movementCredit: 0,
        closingDebit: 0,
        closingCredit: 0,
      },
    ]);
    expect(body.data.totals).toEqual({
      openingDebit: 100,
      openingCredit: 100,
      movementDebit: 100,
      movementCredit: 100,
      closingDebit: 0,
      closingCredit: 0,
      isMovementBalanced: true,
      isClosingBalanced: true,
      movementDifference: 0,
      closingDifference: 0,
    });
    expect(body.data.rows[0].PK).toBeUndefined();
    expect(body.data.rows[0].entityType).toBeUndefined();
    expect(dynamoMock.commandCalls(ScanCommand)).toHaveLength(0);
  });

  test("derives opening before start and inclusive movements from daily aggregates", async () => {
    dynamoMock.on(QueryCommand).resolves({
      Items: [
        {
          accountId: { S: "40110000" },
          openingDebit: { N: "100" },
          openingCredit: { N: "0" },
          movementDebit: { N: "80" },
          movementCredit: { N: "30" },
          dailyDebit_2026_01_10: { N: "50" },
          dailyCredit_2026_02_01: { N: "10" },
          dailyDebit_2026_02_28: { N: "30" },
          dailyCredit_2026_03_01: { N: "20" },
        },
      ],
    });

    const body = parseResponse(
      await handler(
        createEvent({
          startDate: "2026-02-01",
          endDate: "2026-02-28",
        }),
      ),
    );

    expect(body.data.rows[0]).toEqual({
      accountCode: "40110000",
      accountLabel: "Fournisseurs",
      openingDebit: 150,
      openingCredit: 0,
      movementDebit: 30,
      movementCredit: 10,
      closingDebit: 170,
      closingCredit: 0,
    });
  });

  test("filters by prefix, class, range, and hides only fully zero rows", async () => {
    dynamoMock.on(QueryCommand).resolves({
      Items: [
        {
          accountId: { S: "40110000" },
          openingDebit: { N: "0" },
          openingCredit: { N: "0" },
          movementDebit: { N: "0" },
          movementCredit: { N: "0" },
        },
        {
          accountId: { S: "51200000" },
          openingDebit: { N: "10" },
          openingCredit: { N: "0" },
          movementDebit: { N: "0" },
          movementCredit: { N: "0" },
        },
      ],
    });

    const prefixBody = parseResponse(
      await handler(createEvent({ accountPrefix: "401", hideZeroMovement: "true" })),
    );
    expect(prefixBody.data.rows).toEqual([]);

    const classBody = parseResponse(
      await handler(
        createEvent({
          accountClass: "5",
          accountFrom: "51",
          accountTo: "519",
          hideZeroMovement: "true",
        }),
      ),
    );
    expect(classBody.data.rows).toHaveLength(1);
    expect(classBody.data.rows[0].accountCode).toBe("51200000");
  });

  test("rejects partial periods when historical daily aggregates are incomplete", async () => {
    dynamoMock.on(QueryCommand).resolves({
      Items: [
        {
          accountId: { S: "40110000" },
          openingDebit: { N: "0" },
          openingCredit: { N: "0" },
          movementDebit: { N: "100" },
          movementCredit: { N: "0" },
        },
      ],
    });

    const response = await handler(
      createEvent({ startDate: "2026-02-01", endDate: "2026-02-28" }),
    );
    const body = parseResponse(response);

    expect(response.statusCode).toBe(409);
    expect(body.message.code).toBe(
      "ERROR_TRIAL_BALANCE_PERIOD_AGGREGATES_INCOMPLETE",
    );
  });

  test("follows aggregate query pagination and returns a valid empty response", async () => {
    const lastEvaluatedKey = {
      PK: { S: "ORG#test-org#FY#2026" },
      SK: { S: "BAL#40110000" },
    };
    dynamoMock
      .on(QueryCommand)
      .resolvesOnce({ Items: [], LastEvaluatedKey: lastEvaluatedKey })
      .resolvesOnce({ Items: [] });

    const body = parseResponse(await handler(createEvent()));

    expect(body.data.rows).toEqual([]);
    expect(body.data.totals.isMovementBalanced).toBe(true);
    expect(dynamoMock.commandCalls(QueryCommand)).toHaveLength(2);
    expect(
      dynamoMock.commandCalls(QueryCommand)[1].args[0].input.ExclusiveStartKey,
    ).toEqual(lastEvaluatedKey);
    expect(dynamoMock.commandCalls(ScanCommand)).toHaveLength(0);
  });

  test("rejects invalid dates before querying DynamoDB", async () => {
    const response = await handler(
      createEvent({ startDate: "2026-03-01", endDate: "2026-02-01" }),
    );

    expect(response.statusCode).toBe(400);
    expect(dynamoMock.commandCalls(QueryCommand)).toHaveLength(0);
  });
});
