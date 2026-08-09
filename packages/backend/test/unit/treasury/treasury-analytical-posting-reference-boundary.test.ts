import { AccountingTreasuryPostingService } from "@/lambda/domains/accounting/posting/accounting-treasury-posting-service";
import { ProjectAccountingReferenceService } from "@/lambda/domains/projects/references/project-accounting-reference-service";
import {
  BatchGetItemCommand,
  DynamoDBClient,
  GetItemCommand,
  TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { mockClient } from "aws-sdk-client-mock";

const dynamoMock = mockClient(DynamoDBClient);
const tableName = "liass-ohada-test-accounting-table";

jest.mock(
  "@/lambda/domains/projects/references/project-accounting-reference-service",
  () => ({
    ProjectAccountingReferenceService: {
      validateAccountingReferences: jest.fn(),
      validatePostingLine: jest.fn(),
    },
  }),
);

describe("Treasury analytical posting through the Project Accounting boundary", () => {
  beforeEach(() => {
    dynamoMock.reset();
    jest.clearAllMocks();
    jest
      .mocked(ProjectAccountingReferenceService.validateAccountingReferences)
      .mockResolvedValue();
    jest
      .mocked(ProjectAccountingReferenceService.validatePostingLine)
      .mockResolvedValue();
  });

  test("retains Treasury intent, idempotency, and module-granular analytical validation", async () => {
    dynamoMock
      .on(GetItemCommand)
      .resolvesOnce({ Item: undefined })
      .resolvesOnce({
        Item: marshall({
          orgId: "org-a",
          year: 2026,
          fiscalYearId: "FY2026",
          startDate: "2026-01-01",
          endDate: "2026-12-31",
          status: "OPEN",
          accountingFramework: "SYSCOHADA_REVISED",
          entityType: "FISCAL_YEAR",
          PK: "ORG#org-a",
          SK: "FY#2026",
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
        }),
      })
      .resolvesOnce({
        Item: marshall({
          orgId: "org-a",
          year: 2026,
          journalCode: "BANK",
          journalName: "Bank",
          type: "BANK",
          entityType: "JOURNAL",
          PK: "ORG#org-a",
          SK: "JNL#BANK",
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
        }),
      })
      .resolvesOnce({ Item: undefined });
    dynamoMock.on(BatchGetItemCommand).resolves({
      Responses: {
        [tableName]: ["52100000", "60100000"].map((accountId) =>
          marshall({
            orgId: "org-a",
            accountId,
            accountName: `Account ${accountId}`,
            isActive: true,
            isThirdPartyAccount: false,
            requiresThirdParty: false,
            auxiliaryType: "NONE",
            entityType: "ACCOUNT",
            PK: "ORG#org-a",
            SK: `ACC#${accountId}`,
          }),
        ),
      },
    });
    dynamoMock.on(TransactWriteItemsCommand).resolves({});

    const result = await AccountingTreasuryPostingService.postTreasuryTransaction({
      orgId: "org-a",
      userId: "user-1",
      clientRequestId: "11111111-1111-4111-8111-111111111111",
      treasuryAccountId: "treasury-1",
      treasuryAccountingAccountId: "52100000",
      counterpartyAccountId: "60100000",
      year: 2026,
      transactionDate: "2026-03-15",
      journalCode: "BANK",
      direction: "OUTFLOW",
      amount: 1000,
      description: "Project expenditure",
      currency: "XOF",
      projectId: "PRJ-1",
      budgetLineId: "ACT-1",
      donorId: "DONOR-1",
    });

    expect(result.entryId).toMatch(/^E-/);
    expect(
      ProjectAccountingReferenceService.validateAccountingReferences,
    ).toHaveBeenCalledWith({ orgId: "org-a", projectIds: ["PRJ-1"] });
    expect(ProjectAccountingReferenceService.validatePostingLine).toHaveBeenCalledWith({
      orgId: "org-a",
      year: 2026,
      projectId: "PRJ-1",
      budgetLineId: "ACT-1",
      donorId: "DONOR-1",
      debit: 1000,
      credit: 0,
    });

    const transaction =
      dynamoMock.commandCalls(TransactWriteItemsCommand)[0].args[0].input;
    expect(transaction.TransactItems).toHaveLength(6);
    const persistedItems = transaction.TransactItems?.filter((item) => item.Put).map(
      (item) => unmarshall(item.Put?.Item ?? {}),
    );
    expect(persistedItems?.[0]).toMatchObject({
      sourceType: "TREASURY",
      sourceId: "11111111-1111-4111-8111-111111111111",
    });
    expect(persistedItems).toContainEqual(
      expect.objectContaining({
        accountId: "60100000",
        projectId: "PRJ-1",
        budgetLineId: "ACT-1",
        donorId: "DONOR-1",
        debit: 1000,
        credit: 0,
      }),
    );
  });
});
