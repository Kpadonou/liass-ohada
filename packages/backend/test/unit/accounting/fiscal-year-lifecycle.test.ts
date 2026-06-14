import { handler as createFiscalYearHandler } from "@/lambda/domains/accounting/fiscal-year/create-fiscal-year";
import { ClosingService } from "@/lambda/shared/services/closing-service";
import { TenantAccessService } from "@/lambda/shared/services/tenant-access-service";
import {
  DynamoDBClient,
  PutItemCommand,
  TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { mockClient } from "aws-sdk-client-mock";

const dynamoMock = mockClient(DynamoDBClient);

jest.mock("@/lambda/shared/services/tenant-access-service", () => ({
  TenantAccessService: {
    assertUserCanAccessOrg: jest.fn(),
  },
}));

const createEvent = (body: Record<string, unknown>) => ({
  version: "2.0",
  routeKey: "POST /fiscal-year",
  rawPath: "/fiscal-year",
  rawQueryString: "",
  headers: { "accept-language": "en", "x-org-id": "test-org" },
  requestContext: {
    authorizer: {
      jwt: {
        claims: { sub: "user-123" },
        scopes: [],
      },
    },
  },
  body: JSON.stringify(body),
  isBase64Encoded: false,
});

const parseResponse = (response: any) => JSON.parse(response.body ?? "{}");

describe("fiscal year lifecycle", () => {
  beforeEach(() => {
    dynamoMock.reset();
    jest.clearAllMocks();
    jest
      .mocked(TenantAccessService.assertUserCanAccessOrg)
      .mockResolvedValue({ role: "ACCOUNTANT" });
  });

  test("creates an open fiscal year without leaking persistence keys", async () => {
    dynamoMock.on(PutItemCommand).resolves({});

    const response = await createFiscalYearHandler(
      createEvent({ year: 2026, accountingFramework: "SYSCOHADA_REVISED" }) as any,
    );
    const body = parseResponse(response);
    const putInput = dynamoMock.commandCalls(PutItemCommand)[0].args[0].input;
    const item = unmarshall(putInput.Item ?? {});

    expect(response.statusCode).toBe(200);
    expect(item.PK).toBe("ORG#test-org");
    expect(item.SK).toBe("FY#2026");
    expect(body.data).toMatchObject({
      year: 2026,
      status: "OPEN",
      startDate: "2026-01-01",
      endDate: "2026-12-31",
    });
    expect(body.data.PK).toBeUndefined();
    expect(body.data.SK).toBeUndefined();
  });

  test("year-end closing writes header, lines, balance updates and fiscal-year transition atomically", async () => {
    dynamoMock.on(TransactWriteItemsCommand).resolves({});

    const result = await ClosingService.executeYearEnd("test-org", {
      year: "2026",
      userId: "user-123",
      balances: [
        {
          accountId: "60100000",
          openingDebit: 0,
          openingCredit: 0,
          movementDebit: 1500,
          movementCredit: 0,
        },
        {
          accountId: "70100000",
          openingDebit: 0,
          openingCredit: 0,
          movementDebit: 0,
          movementCredit: 2500,
        },
      ],
    });
    const transaction =
      dynamoMock.commandCalls(TransactWriteItemsCommand)[0].args[0].input;
    const header = unmarshall(transaction.TransactItems?.[0].Put?.Item ?? {});
    const fiscalYearUpdate = transaction.TransactItems?.[1].Update;

    expect(result).toEqual({
      entryId: "YEC-2026",
      netResult: 1000,
      isProfit: true,
    });
    expect(header.entryType).toBe("CLOSING");
    expect(header.journalCode).toBe("CLOSING");
    expect(fiscalYearUpdate?.ConditionExpression).toBe("#s = :open");
    expect(transaction.TransactItems).toHaveLength(8);
  });

  test("year-end closing maps transaction conflicts to a business error", async () => {
    const error = new Error("cancelled");
    error.name = "TransactionCanceledException";
    dynamoMock.on(TransactWriteItemsCommand).rejects(error);

    await expect(
      ClosingService.executeYearEnd("test-org", {
        year: "2026",
        userId: "user-123",
        balances: [
          {
            accountId: "60100000",
            openingDebit: 0,
            openingCredit: 0,
            movementDebit: 100,
            movementCredit: 0,
          },
        ],
      }),
    ).rejects.toMatchObject({ messageCode: "ERROR_FISCAL_YEAR_CLOSE_CONFLICT" });
  });
});
