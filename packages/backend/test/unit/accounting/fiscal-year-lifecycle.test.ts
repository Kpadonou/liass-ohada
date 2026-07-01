import { handler as createFiscalYearHandler } from "@/lambda/domains/accounting/fiscal-year/create-fiscal-year";
import { handler as closeFiscalYearHandler } from "@/lambda/domains/accounting/fiscal-year/close-fiscal-year";
import { handler as getClosingChecksHandler } from "@/lambda/domains/accounting/fiscal-year/get-closing-checks";
import { ClosingService } from "@/lambda/shared/services/closing-service";
import { TenantAccessService } from "@/lambda/shared/services/tenant-access-service";
import {
  BatchGetItemCommand,
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  QueryCommand,
  ScanCommand,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
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

const createTenantEvent = (
  method: string,
  routeKey: string,
  pathParameters: Record<string, string>,
  body?: Record<string, unknown>,
  orgId = "test-org",
) => ({
  version: "2.0",
  routeKey,
  rawPath: routeKey.replace(`${method} `, ""),
  rawQueryString: "",
  pathParameters,
  headers: { "accept-language": "en", "x-org-id": orgId },
  requestContext: {
    authorizer: {
      jwt: {
        claims: { sub: "user-123" },
        scopes: [],
      },
    },
  },
  body: body ? JSON.stringify(body) : undefined,
  isBase64Encoded: false,
});

const parseResponse = (response: any) => JSON.parse(response.body ?? "{}");

const fiscalYear = (status = "OPEN", orgId = "test-org") =>
  marshall(cleanUndefined({
    orgId,
    year: 2026,
    fiscalYearId: "FY2026",
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    status,
    accountingFramework: "SYSCOHADA_REVISED",
    entityType: "FISCAL_YEAR",
    PK: `ORG#${orgId}`,
    SK: "FY#2026",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }));

const entry = (overrides: Record<string, unknown> = {}) =>
  marshall(cleanUndefined({
    orgId: "test-org",
    year: 2026,
    entryId: "E-1",
    entryType: "STANDARD",
    entryDate: "2026-03-15",
    journalCode: "SALES",
    totalDebit: 1000,
    totalCredit: 1000,
    status: "POSTED",
    entityType: "ENTRY",
    PK: "ORG#test-org#FY#2026",
    SK: "E#E-1",
    GSI5PK: "ORG#test-org#FY#2026",
    GSI5SK: "JNL#SALES#DT#2026-03-15#E#E-1",
    GSI7PK: "ORG#test-org#FY#2026",
    GSI7SK: "DT#2026-03-15#E#E-1",
    createdAt: "2026-03-15T00:00:00.000Z",
    updatedAt: "2026-03-15T00:00:00.000Z",
    ...overrides,
  }));

const line = (overrides: Record<string, unknown> = {}) =>
  marshall(cleanUndefined({
    orgId: "test-org",
    year: 2026,
    entryId: "E-1",
    lineId: "E-1#L1",
    accountId: "51200000",
    debit: 1000,
    credit: 0,
    entryDate: "2026-03-15",
    journalCode: "SALES",
    entityType: "ENTRY_LINE",
    PK: "ORG#test-org#FY#2026",
    SK: "L#E-1#L1",
    GSI1PK: "ORG#test-org",
    GSI1SK: "ACC#51200000#FY#2026#DT#2026-03-15#E-1#L1",
    createdAt: "2026-03-15T00:00:00.000Z",
    updatedAt: "2026-03-15T00:00:00.000Z",
    ...overrides,
  }));

const account = (
  accountId: string,
  overrides: Record<string, unknown> = {},
) =>
  marshall(cleanUndefined({
    orgId: "test-org",
    accountId,
    accountName: accountId,
    accountNature: accountId.startsWith("7") ? "INCOME" : "BALANCE",
    accountUsage: "BOTH",
    isThirdPartyAccount: false,
    requiresThirdParty: false,
    auxiliaryType: "NONE",
    classCode: Number(accountId[0]),
    financialStatementCode: "NA",
    allowReconciliation: false,
    isActive: true,
    entityType: "ACCOUNT",
    PK: "ORG#test-org",
    SK: `ACC#${accountId}`,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  }));

const journal = () =>
  marshall({
    orgId: "test-org",
    year: 2026,
    journalCode: "SALES",
    journalName: "Sales",
    type: "SALE",
    entityType: "JOURNAL",
    PK: "ORG#test-org",
    SK: "JNL#SALES",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });

const balance = (
  accountId: string,
  movementDebit: number,
  movementCredit: number,
) =>
  marshall({
    PK: "ORG#test-org#FY#2026",
    SK: `BAL#${accountId}`,
    entityType: "ACCOUNT_BALANCE",
    accountId,
    openingDebit: 0,
    openingCredit: 0,
    movementDebit,
    movementCredit,
  });

const cleanUndefined = (value: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  );

const mockCleanClosingData = () => {
  dynamoMock.on(GetItemCommand).resolves({ Item: fiscalYear() });
  dynamoMock.on(QueryCommand).callsFake(async (input) => {
    const values = input.ExpressionAttributeValues ?? {};
    const sk =
      values[":sk"]?.S ??
      values[":skPrefix"]?.S ??
      values[":sk"]?.S;

    if (sk === "E#") {
      return { Items: [entry()] };
    }
    if (sk === "L#") {
      return {
        Items: [
          line(),
          line({
            lineId: "E-1#L2",
            SK: "L#E-1#L2",
            accountId: "70100000",
            debit: 0,
            credit: 1000,
          }),
        ],
      };
    }
    if (sk === "BAL#") {
      return {
        Items: [
          balance("51200000", 1000, 0),
          balance("70100000", 0, 1000),
        ],
      };
    }
    if (sk === "JNL#") {
      return { Items: [journal()] };
    }

    return { Items: [] };
  });
  dynamoMock.on(BatchGetItemCommand).resolves({
    Responses: {
      "liass-ohada-test-accounting-table": [
        account("51200000"),
        account("70100000"),
      ],
    },
  });
};

describe("fiscal year lifecycle", () => {
  beforeEach(() => {
    dynamoMock.reset();
    jest.clearAllMocks();
    jest
      .mocked(TenantAccessService.assertUserCanAccessOrg)
      .mockResolvedValue({
        role: "ACCOUNTANT",
        accountingFramework: "SYSCOHADA_REVISED",
      });
  });

  test("creates an open fiscal year without leaking persistence keys", async () => {
    dynamoMock.on(PutItemCommand).resolves({});

    const response = await createFiscalYearHandler(
      createEvent({ year: 2026 }) as any,
    );
    const body = parseResponse(response);
    const putInput = dynamoMock.commandCalls(PutItemCommand)[0].args[0].input;
    const item = unmarshall(putInput.Item ?? {});

    expect(response.statusCode).toBe(200);
    expect(item.PK).toBe("ORG#test-org");
    expect(item.SK).toBe("FY#2026");
    expect(item.accountingFramework).toBe("SYSCOHADA_REVISED");
    expect(body.data).toMatchObject({
      year: 2026,
      status: "OPEN",
      startDate: "2026-01-01",
      endDate: "2026-12-31",
      accountingFramework: "SYSCOHADA_REVISED",
    });
    expect(body.data.PK).toBeUndefined();
    expect(body.data.SK).toBeUndefined();
  });

  test("derives fiscal year accounting framework from tenant context", async () => {
    jest
      .mocked(TenantAccessService.assertUserCanAccessOrg)
      .mockResolvedValue({
        role: "ACCOUNTANT",
        accountingFramework: "SYCEBNL",
      });
    dynamoMock.on(PutItemCommand).resolves({});

    const response = await createFiscalYearHandler(
      createEvent({ year: 2027 }) as any,
    );
    const putInput = dynamoMock.commandCalls(PutItemCommand)[0].args[0].input;
    const item = unmarshall(putInput.Item ?? {});
    const body = parseResponse(response);

    expect(response.statusCode).toBe(200);
    expect(item.accountingFramework).toBe("SYCEBNL");
    expect(body.data.accountingFramework).toBe("SYCEBNL");
  });

  test("rejects client attempts to override fiscal year accounting framework", async () => {
    const response = await createFiscalYearHandler(
      createEvent({ year: 2028, accountingFramework: "SYCEBNL" }) as any,
    );
    const body = parseResponse(response);

    expect(response.statusCode).toBe(400);
    expect(body.errors?.[0]?.path).toBe("");
    expect(dynamoMock.commandCalls(PutItemCommand)).toHaveLength(0);
  });

  test("closing checks return canClose true for a clean fiscal year", async () => {
    mockCleanClosingData();

    const result = await ClosingService.runClosingChecks("test-org", "2026");

    expect(result.canClose).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.summary).toMatchObject({
      draftEntriesCount: 0,
      postedEntriesCount: 1,
      unbalancedEntriesCount: 0,
      trialBalanceDebit: 1000,
      trialBalanceCredit: 1000,
    });
    expect((result.summary.fiscalYear as any).PK).toBeUndefined();
    expect(dynamoMock.commandCalls(ScanCommand)).toHaveLength(0);
  });

  test("closing checks flag draft entries and unbalanced entries", async () => {
    mockCleanClosingData();
    dynamoMock.on(QueryCommand).callsFake(async (input) => {
      const values = input.ExpressionAttributeValues ?? {};
      const sk = values[":sk"]?.S ?? values[":skPrefix"]?.S;
      if (sk === "E#") {
        return {
          Items: [
            entry({ entryId: "E-1", totalDebit: 1000, totalCredit: 900 }),
            entry({
              entryId: "D-1",
              SK: "E#D-1",
              status: "DRAFT",
              totalDebit: 0,
              totalCredit: 0,
              GSI7PK: undefined,
              GSI7SK: undefined,
            }),
          ],
        };
      }
      if (sk === "L#") {
        return { Items: [line({ credit: 900 })] };
      }
      if (sk === "BAL#") {
        return { Items: [balance("51200000", 1000, 900)] };
      }
      if (sk === "JNL#") {
        return { Items: [journal()] };
      }
      return { Items: [] };
    });

    const result = await ClosingService.runClosingChecks("test-org", "2026");

    expect(result.canClose).toBe(false);
    expect(result.errors.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "ENTRY_NOT_BALANCED",
        "DRAFT_ENTRIES_REMAIN",
        "TRIAL_BALANCE_NOT_BALANCED",
      ]),
    );
    expect(result.summary.unbalancedEntriesCount).toBe(1);
  });

  test("closing checks warn, but do not block, for unlettered customer lines", async () => {
    mockCleanClosingData();
    dynamoMock.on(QueryCommand).callsFake(async (input) => {
      const values = input.ExpressionAttributeValues ?? {};
      const sk = values[":sk"]?.S ?? values[":skPrefix"]?.S;
      if (sk === "E#") return { Items: [entry()] };
      if (sk === "L#") {
        return {
          Items: [
            line({
              accountId: "41100000",
              thirdPartyId: "TP-1",
              thirdPartyType: "CUSTOMER",
              letteringStatus: "UNLETTERED",
              GSI3PK: "ORG#test-org#ACC#41100000#TP#TP-1",
              GSI3SK: "UNLETTERED#2026-03-15#E-1#0001",
            }),
            line({
              lineId: "E-1#L2",
              SK: "L#E-1#L2",
              accountId: "70100000",
              debit: 0,
              credit: 1000,
            }),
          ],
        };
      }
      if (sk === "BAL#") {
        return {
          Items: [
            balance("41100000", 1000, 0),
            balance("70100000", 0, 1000),
          ],
        };
      }
      if (sk === "JNL#") return { Items: [journal()] };
      return { Items: [] };
    });
    dynamoMock.on(BatchGetItemCommand).resolves({
      Responses: {
        "liass-ohada-test-accounting-table": [
          account("41100000", {
            isThirdPartyAccount: true,
            requiresThirdParty: true,
            auxiliaryType: "CUSTOMER",
          }),
          account("70100000"),
        ],
      },
    });

    const result = await ClosingService.runClosingChecks("test-org", "2026");

    expect(result.canClose).toBe(true);
    expect(result.warnings).toEqual([
      expect.objectContaining({ code: "UNLETTERED_AUXILIARY_LINES_REMAIN" }),
    ]);
    expect(result.summary.unletteredAuxiliaryLinesCount).toBe(1);
  });

  test("fiscal year close runs checks and marks a clean year closed", async () => {
    mockCleanClosingData();
    dynamoMock.on(UpdateItemCommand).resolves({
      Attributes: fiscalYear("CLOSED"),
    });

    const response = await closeFiscalYearHandler(
      createTenantEvent(
        "POST",
        "POST /fiscal-year/{year}/close",
        { year: "2026" },
        {},
      ) as any,
    );
    const body = parseResponse(response);
    const updateInput =
      dynamoMock.commandCalls(UpdateItemCommand)[0].args[0].input;
    const key = unmarshall(updateInput.Key ?? {});

    expect(response.statusCode).toBe(200);
    expect(key).toEqual({ PK: "ORG#test-org", SK: "FY#2026" });
    expect(body.data.fiscalYear.status).toBe("CLOSED");
    expect(body.data.checks.canClose).toBe(true);
    expect(body.data.fiscalYear.PK).toBeUndefined();
  });

  test("fiscal year close rejects blocking checks before updating", async () => {
    mockCleanClosingData();
    dynamoMock.on(QueryCommand).callsFake(async (input) => {
      const values = input.ExpressionAttributeValues ?? {};
      const sk = values[":sk"]?.S ?? values[":skPrefix"]?.S;
      if (sk === "E#") {
        return { Items: [entry({ status: "DRAFT", GSI7PK: undefined, GSI7SK: undefined })] };
      }
      if (sk === "L#") return { Items: [] };
      if (sk === "BAL#") return { Items: [] };
      if (sk === "JNL#") return { Items: [journal()] };
      return { Items: [] };
    });

    const response = await closeFiscalYearHandler(
      createTenantEvent(
        "POST",
        "POST /fiscal-year/{year}/close",
        { year: "2026" },
        {},
      ) as any,
    );
    const body = parseResponse(response);

    expect(response.statusCode).toBe(400);
    expect(body.message.code).toBe("ERROR_FISCAL_YEAR_CLOSE_CHECKS_FAILED");
    expect(dynamoMock.commandCalls(UpdateItemCommand)).toHaveLength(0);
  });

  test("fiscal year close is idempotent when already closed", async () => {
    mockCleanClosingData();
    dynamoMock.on(GetItemCommand).resolves({ Item: fiscalYear("CLOSED") });

    const result = await ClosingService.closeFiscalYear({
      orgId: "test-org",
      userId: "user-123",
      year: "2026",
    });

    expect(result.fiscalYear.status).toBe("CLOSED");
    expect(result.checks.canClose).toBe(true);
    expect(dynamoMock.commandCalls(UpdateItemCommand)).toHaveLength(0);
  });

  test("closing checks handler preserves tenant isolation in query keys", async () => {
    mockCleanClosingData();
    dynamoMock.on(GetItemCommand).resolves({ Item: fiscalYear("OPEN", "tenant-b") });

    await getClosingChecksHandler(
      createTenantEvent(
        "GET",
        "GET /fiscal-year/{year}/closing-checks",
        { year: "2026" },
        undefined,
        "tenant-b",
      ) as any,
    );

    const fiscalYearQueries = dynamoMock
      .commandCalls(QueryCommand)
      .map((call) => call.args[0].input)
      .filter((input) => input.KeyConditionExpression?.includes("PK = :pk"));
    const queryPks = fiscalYearQueries.map(
      (input) => input.ExpressionAttributeValues?.[":pk"]?.S,
    );

    expect(queryPks).toContain("ORG#tenant-b#FY#2026");
    expect(queryPks).not.toContain("ORG#test-org#FY#2026");
  });
});
