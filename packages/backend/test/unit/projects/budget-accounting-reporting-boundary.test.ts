import { AccountingProjectReportingService } from "@/lambda/domains/accounting/reporting/accounting-project-reporting-service";
import { BudgetService } from "@/lambda/domains/projects/services/budget-service";
import { DynamoDBClient, GetItemCommand, QueryCommand } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { mockClient } from "aws-sdk-client-mock";

const dynamoMock = mockClient(DynamoDBClient);

jest.mock(
  "@/lambda/domains/accounting/reporting/accounting-project-reporting-service",
  () => ({
    AccountingProjectReportingService: {
      listProjectFacts: jest.fn(),
    },
  }),
);

describe("BudgetService Accounting reporting boundary", () => {
  beforeEach(() => {
    dynamoMock.reset();
    jest.clearAllMocks();
  });

  test("keeps realized budget and donor cash calculations over key-free Accounting facts", async () => {
    dynamoMock
      .on(GetItemCommand)
      .resolvesOnce({
        Item: marshall({
          PK: "ORG#org-a",
          SK: "PRJ#PRJ-1#BDG#2026#L#ACT-1",
          entityType: "BUDGET_LINE",
          projectId: "PRJ-1",
          fiscalYear: "2026",
          code: "ACT-1",
          label: "Activity",
          amount: 1000,
          category: "ACTIVITY",
        }),
      })
      .resolvesOnce({
        Item: marshall({
          PK: "ORG#org-a",
          SK: "PRJ#PRJ-1#FS#DONOR-1",
          entityType: "FUNDING_SOURCE",
          projectId: "PRJ-1",
          donorId: "DONOR-1",
          amount: 2000,
        }),
      });
    jest.mocked(AccountingProjectReportingService.listProjectFacts).mockResolvedValue([
      {
        entryId: "entry-1",
        entryLineId: "line-1",
        date: "2026-03-01",
        year: 2026,
        accountId: "60100000",
        debit: 300,
        credit: 0,
        projectId: "PRJ-1",
        donorId: "DONOR-1",
        budgetLineId: "ACT-1",
      },
      {
        entryId: "entry-2",
        entryLineId: "line-2",
        date: "2026-03-02",
        year: 2026,
        accountId: "71800000",
        debit: 0,
        credit: 900,
        projectId: "PRJ-1",
        donorId: "DONOR-1",
      },
    ]);

    const result = await BudgetService.getAvailableBudget(
      "org-a",
      "PRJ-1",
      "ACT-1",
      2026,
      "DONOR-1",
    );

    expect(AccountingProjectReportingService.listProjectFacts).toHaveBeenCalledWith({
      orgId: "org-a",
      projectId: "PRJ-1",
      year: "2026",
    });
    expect(result).toMatchObject({
      budgetLine: {
        code: "ACT-1",
        allocated: 1000,
        spent: 300,
        available: 700,
      },
      donor: {
        id: "DONOR-1",
        contractAmount: 2000,
        cashReceived: 900,
        totalSpent: 300,
        budgetAvailable: 1700,
        cashAvailable: 600,
      },
    });
    expect(result?.canSpend(600)).toBe(true);
    expect(result?.canSpend(601)).toBe(false);
    expect(dynamoMock.commandCalls(QueryCommand)).toHaveLength(0);
  });

  test("preserves the absence of a configured budget as a non-blocking reference", async () => {
    dynamoMock.on(GetItemCommand).resolves({ Item: undefined });

    await expect(
      BudgetService.enforceBudget("org-a", 2026, {
        projectId: "PRJ-1",
        debit: 500,
        credit: 0,
      }),
    ).resolves.toBeUndefined();

    expect(dynamoMock.commandCalls(GetItemCommand)).toHaveLength(1);
    expect(AccountingProjectReportingService.listProjectFacts).not.toHaveBeenCalled();
  });

  test("does not invent a standalone donor-existence error when the funding source is absent", async () => {
    dynamoMock
      .on(GetItemCommand)
      .resolvesOnce({
        Item: marshall({
          PK: "ORG#org-a",
          SK: "PRJ#PRJ-1#BDG#2026#L#ACT-1",
          entityType: "BUDGET_LINE",
          projectId: "PRJ-1",
          fiscalYear: "2026",
          code: "ACT-1",
          label: "Activity",
          amount: 1000,
          category: "ACTIVITY",
        }),
      })
      .resolvesOnce({ Item: undefined });
    jest.mocked(AccountingProjectReportingService.listProjectFacts).mockResolvedValue([
      {
        entryId: "entry-1",
        entryLineId: "line-1",
        date: "2026-03-01",
        year: 2026,
        accountId: "71800000",
        debit: 0,
        credit: 1000,
        projectId: "PRJ-1",
        donorId: "DONOR-1",
      },
    ]);

    await expect(
      BudgetService.enforceBudget("org-a", 2026, {
        projectId: "PRJ-1",
        budgetLineId: "ACT-1",
        donorId: "DONOR-1",
        debit: 500,
        credit: 0,
      }),
    ).resolves.toBeUndefined();

    expect(dynamoMock.commandCalls(GetItemCommand)).toHaveLength(2);
  });
});
