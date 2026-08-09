import { allowAccountingProductAccess } from "@/test/helpers/product-access";
import { handler } from "@/lambda/domains/accounting/reports/get-summary";
import { ClosingService } from "@/lambda/shared/services/closing-service";
import { LedgerService } from "@/lambda/shared/services/ledger-service";
import { SimplifiedReportingService } from "@/lambda/shared/services/simplified-reporting-service";
import { TenantAccessService } from "@/lambda/shared/services/tenant-access-service";
import { ThirdPartyService } from "@/lambda/shared/services/third-party-service";
import {
  DynamoDBClient,
  GetItemCommand,
  QueryCommand,
  ScanCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { mockClient } from "aws-sdk-client-mock";

const dynamoMock = mockClient(DynamoDBClient);

jest.mock("@/lambda/shared/services/tenant-access-service", () => ({
  TenantAccessService: {
    assertUserCanAccessOrg: jest.fn(),
  },
}));

const fiscalYearItem = (orgId = "org-a") =>
  marshall({
    orgId,
    year: 2026,
    fiscalYearId: "FY-2026",
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    status: "OPEN",
    accountingFramework: "SYSCOHADA_REVISED",
    entityType: "FISCAL_YEAR",
    PK: `ORG#${orgId}`,
    SK: "FY#2026",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });

const balance = (
  accountId: string,
  movementDebit: number,
  movementCredit: number,
  daily: Record<string, number> = {},
) =>
  marshall({
    PK: "ORG#org-a#FY#2026",
    SK: `BAL#${accountId}`,
    entityType: "ACCOUNT_BALANCE",
    accountId,
    openingDebit: 0,
    openingCredit: 0,
    movementDebit,
    movementCredit,
    ...daily,
  });

const createEvent = (
  queryStringParameters: Record<string, string> = {},
  orgId = "org-a",
  path = "/reports/summary",
) => ({
  version: "2.0",
  routeKey: `GET ${path}`,
  rawPath: path,
  rawQueryString: "",
  queryStringParameters: {
    fiscalYear: "2026",
    includeAuxiliary: "false",
    includeClosingChecks: "false",
    ...queryStringParameters,
  },
  headers: { "accept-language": "en", "x-org-id": orgId },
  requestContext: {
    http: { method: "GET", path },
    authorizer: { jwt: { claims: { sub: "user-123" }, scopes: [] } },
  },
  isBase64Encoded: false,
});

const parseResponse = (response: any) =>
  JSON.parse(typeof response === "string" ? response : response.body ?? "{}");

const setupCoreDynamoMocks = () => {
  dynamoMock.on(GetItemCommand).callsFake(async (input) => {
    const key = unmarshall(input.Key as Record<string, any>);
    if (key.PK === "ORG#org-a" && key.SK === "FY#2026") {
      return { Item: fiscalYearItem() };
    }
    return {};
  });

  dynamoMock.on(QueryCommand).callsFake(async (input) => {
    const values = unmarshall(
      input.ExpressionAttributeValues as Record<string, any>,
    );

    if (input.IndexName === "GSI7") {
      expect(values[":pk"]).toBe("ORG#org-a#FY#2026");
      return {
        Items: [
          marshall({
            GSI7PK: "ORG#org-a#FY#2026",
            GSI7SK: "DT#2026-03-15#E#POSTED-1",
            entryId: "POSTED-1",
            status: "POSTED",
          }),
        ],
      };
    }

    if (values[":skPrefix"] === "BAL#") {
      expect(values[":pk"]).toBe("ORG#org-a#FY#2026");
      return {
          Items: [
          balance("51200000", 60000, 0, {
            dailyDebit_2026_03_15: 60000,
          }),
          balance("60100000", 40000, 0, {
            dailyDebit_2026_03_15: 40000,
          }),
          balance("70100000", 0, 100000, {
            dailyCredit_2026_03_15: 100000,
          }),
        ],
      };
    }

    return { Items: [] };
  });
};

describe("Lot 6.3 simplified reporting", () => {
  beforeEach(() => {
    dynamoMock.reset();
    jest.restoreAllMocks();
    jest.clearAllMocks();
    allowAccountingProductAccess();
    jest
      .mocked(TenantAccessService.assertUserCanAccessOrg)
      .mockResolvedValue({ role: "ACCOUNTANT", workspaceType: "COMPANY" });
  });

  test("returns a safe operational report from GET /reports/summary posted aggregates only", async () => {
    setupCoreDynamoMocks();

    const response = await handler(createEvent() as any);
    const body = parseResponse(response);

    expect(response.statusCode).toBe(200);
    expect(body.message.message).toBe(
      "Accounting overview summary retrieved successfully.",
    );
    expect(body.data.trialBalance).toEqual({
      totalDebit: 100000,
      totalCredit: 100000,
      isBalanced: true,
      accountCount: 3,
      movementCount: 1,
    });
    expect(body.data.income).toMatchObject({
      totalRevenue: 100000,
      totalExpense: 40000,
      netResult: 60000,
      revenueAccounts: [
        {
          accountId: "70100000",
          totalDebit: 0,
          totalCredit: 100000,
          netAmount: 100000,
        },
      ],
      expenseAccounts: [
        {
          accountId: "60100000",
          totalDebit: 40000,
          totalCredit: 0,
          netAmount: 40000,
        },
      ],
    });
    expect(JSON.stringify(body.data)).not.toContain("PK");
    expect(JSON.stringify(body.data)).not.toContain("SK");
    expect(JSON.stringify(body.data)).not.toContain("GSI");
    expect(JSON.stringify(body.data)).not.toContain("entityType");
    expect(dynamoMock.commandCalls(ScanCommand)).toHaveLength(0);

    for (const call of dynamoMock.commandCalls(QueryCommand)) {
      expect(call.args[0].input.ConsistentRead).toBeUndefined();
    }
  });

  test("keeps GET /reports/simplified as a deprecated compatibility alias", async () => {
    setupCoreDynamoMocks();

    const response = await handler(
      createEvent({}, "org-a", "/reports/simplified") as any,
    );
    const body = parseResponse(response);

    expect(response.statusCode).toBe(200);
    expect(body.data.period.fiscalYear).toBe("2026");
    expect(body.data.trialBalance.isBalanced).toBe(true);
    expect(dynamoMock.commandCalls(ScanCommand)).toHaveLength(0);
  });

  test("respects selected date ranges for trial balance and income totals", async () => {
    setupCoreDynamoMocks();

    const response = await handler(
      createEvent({
        startDate: "2026-03-01",
        endDate: "2026-03-31",
      }) as any,
    );
    const body = parseResponse(response);
    const gsi7Query = dynamoMock
      .commandCalls(QueryCommand)
      .find((call) => call.args[0].input.IndexName === "GSI7")!
      .args[0].input;
    const values = unmarshall(
      gsi7Query.ExpressionAttributeValues as Record<string, any>,
    );

    expect(body.data.period).toMatchObject({
      fiscalYear: "2026",
      startDate: "2026-03-01",
      endDate: "2026-03-31",
    });
    expect(body.data.trialBalance.totalDebit).toBe(100000);
    expect(body.data.trialBalance.totalCredit).toBe(100000);
    expect(body.data.trialBalance.isBalanced).toBe(true);
    expect(body.data.income.netResult).toBe(60000);
    expect(values[":from"]).toBe("DT#2026-03-01#E#");
    expect(values[":to"]).toBe("DT#2026-03-31#E#\uffff");
  });

  test("rejects dates outside the fiscal year before reporting", async () => {
    setupCoreDynamoMocks();

    const response = await handler(
      createEvent({
        startDate: "2025-12-31",
        endDate: "2026-12-31",
      }) as any,
    );

    expect(response.statusCode).toBe(400);
    expect(dynamoMock.commandCalls(QueryCommand)).toHaveLength(0);
  });

  test("reuses auxiliary balance and closing checks when requested", async () => {
    setupCoreDynamoMocks();
    jest.spyOn(LedgerService, "listAccounts").mockResolvedValue({
      accounts: [
        auxiliaryAccount("41100000", "CUSTOMER"),
        auxiliaryAccount("40100000", "SUPPLIER"),
      ],
      hasMore: false,
    });
    jest
      .spyOn(ThirdPartyService, "getBalance")
      .mockImplementation(async (_orgId, params) => ({
        accountId: params.accountId.padEnd(8, "0"),
        thirdPartyType: params.thirdPartyType,
        account: auxiliaryAccount(
          params.accountId.padEnd(8, "0"),
          params.thirdPartyType,
        ),
        period: {
          fiscalYear: params.fiscalYear,
          startDate: params.startDate ?? "2026-01-01",
          endDate: params.endDate ?? "2026-12-31",
        },
        rows: [
          {
            thirdPartyId: params.thirdPartyType === "CUSTOMER" ? "cust-1" : "sup-1",
            thirdPartyType: params.thirdPartyType,
            thirdPartyCode: params.thirdPartyType === "CUSTOMER" ? "CUST-1" : "SUP-1",
            thirdPartyName:
              params.thirdPartyType === "CUSTOMER" ? "Client 1" : "Supplier 1",
            accountId: params.accountId.padEnd(8, "0"),
            accountCode: params.accountId.padEnd(8, "0"),
            accountLabel:
              params.thirdPartyType === "CUSTOMER" ? "Clients" : "Suppliers",
            openingDebit: 0,
            openingCredit: 0,
            movementDebit: params.thirdPartyType === "CUSTOMER" ? 100000 : 20000,
            movementCredit: params.thirdPartyType === "CUSTOMER" ? 30000 : 50000,
            closingDebit: params.thirdPartyType === "CUSTOMER" ? 70000 : 0,
            closingCredit: params.thirdPartyType === "CUSTOMER" ? 0 : 30000,
            balance: params.thirdPartyType === "CUSTOMER" ? 70000 : -30000,
            unletteredAmount: params.thirdPartyType === "CUSTOMER" ? 70000 : 0,
          },
        ],
        summary: {
          totalOpeningDebit: 0,
          totalOpeningCredit: 0,
          totalMovementDebit:
            params.thirdPartyType === "CUSTOMER" ? 100000 : 20000,
          totalMovementCredit:
            params.thirdPartyType === "CUSTOMER" ? 30000 : 50000,
          totalClosingDebit: params.thirdPartyType === "CUSTOMER" ? 70000 : 0,
          totalClosingCredit: params.thirdPartyType === "CUSTOMER" ? 0 : 30000,
          thirdPartyCount: 1,
          balance: params.thirdPartyType === "CUSTOMER" ? 70000 : -30000,
        },
        count: 1,
        hasMore: false,
      }));
    jest.spyOn(ClosingService, "runClosingChecks").mockResolvedValue({
      canClose: false,
      errors: [{ code: "DRAFT_ENTRIES_REMAIN", scope: "ENTRY" }],
      warnings: [{ code: "UNLETTERED_AUXILIARY_LINES_REMAIN", scope: "AUXILIARY" }],
      summary: {
        fiscalYear: {
          year: 2026,
          fiscalYearId: "FY-2026",
          startDate: "2026-01-01",
          endDate: "2026-12-31",
          status: "OPEN",
          accountingFramework: "SYSCOHADA_REVISED",
        },
        draftEntriesCount: 2,
        postedEntriesCount: 1,
        unbalancedEntriesCount: 0,
        trialBalanceDebit: 100000,
        trialBalanceCredit: 100000,
        unletteredAuxiliaryLinesCount: 4,
      },
    });

    const report = await SimplifiedReportingService.getSummaryReport(
      "org-a",
      {
        fiscalYear: "2026",
        includeAuxiliary: true,
        includeClosingChecks: true,
      },
    );

    expect(report.auxiliary?.customers).toMatchObject({
      accountIds: ["41100000"],
      totalDebit: 100000,
      totalCredit: 30000,
      totalBalanceDebit: 70000,
      totalBalanceCredit: 0,
      unletteredAmount: 70000,
      thirdPartyCount: 1,
    });
    expect(report.auxiliary?.suppliers).toMatchObject({
      accountIds: ["40100000"],
      totalDebit: 20000,
      totalCredit: 50000,
      totalBalanceDebit: 0,
      totalBalanceCredit: 30000,
    });
    expect(report.closingReadiness).toEqual({
      canClose: false,
      errorsCount: 1,
      warningsCount: 1,
      draftEntriesCount: 2,
      unbalancedEntriesCount: 0,
      unletteredAuxiliaryLinesCount: 4,
    });
    expect(ClosingService.runClosingChecks).toHaveBeenCalledWith(
      "org-a",
      "2026",
      { allowClosedFiscalYear: true },
    );
  });
});

function auxiliaryAccount(
  accountId: string,
  auxiliaryType: "CUSTOMER" | "SUPPLIER",
) {
  return {
    accountId,
    accountName: auxiliaryType === "CUSTOMER" ? "Clients" : "Suppliers",
    accountNature: "BALANCE" as const,
    accountUsage: "BOTH" as const,
    isThirdPartyAccount: true,
    requiresThirdParty: true,
    auxiliaryType,
    classCode: 4,
    financialStatementCode: "BA",
    allowReconciliation: true,
    isActive: true,
  };
}
