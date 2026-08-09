import { ProjectAccountingReferenceService } from "@/lambda/domains/projects/references/project-accounting-reference-service";
import { AppError } from "@/lambda/shared/middleware/handler-wrapper";
import { LedgerService } from "@/lambda/shared/services/ledger-service";
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

const fiscalYearItem = marshall({
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
});

const journalItem = marshall({
  orgId: "org-a",
  year: 2026,
  journalCode: "MISC",
  journalName: "Operations diverses",
  type: "MISC",
  entityType: "JOURNAL",
  PK: "ORG#org-a",
  SK: "JNL#MISC",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
});

const accountItems = ["60100000", "52100000"].map((accountId) =>
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
);

const analyticalEntry = {
  year: 2026,
  entryDate: "2026-03-15",
  journalCode: "MISC",
  entryType: "STANDARD" as const,
  label: "Project expenditure",
  lines: [
    {
      accountId: "60100000",
      projectId: "PRJ-1",
      budgetLineId: "ACT-1",
      donorId: "DONOR-1",
      debit: 1000,
      credit: 0,
    },
    { accountId: "52100000", debit: 0, credit: 1000 },
  ],
};

describe("LedgerService Project Accounting reference boundary", () => {
  beforeEach(() => {
    dynamoMock.reset();
    jest.clearAllMocks();
    jest
      .mocked(ProjectAccountingReferenceService.validateAccountingReferences)
      .mockResolvedValue();
    jest
      .mocked(ProjectAccountingReferenceService.validatePostingLine)
      .mockResolvedValue();
    dynamoMock
      .on(GetItemCommand)
      .resolvesOnce({ Item: fiscalYearItem })
      .resolvesOnce({ Item: journalItem })
      .resolvesOnce({ Item: undefined });
    dynamoMock.on(BatchGetItemCommand).resolves({
      Responses: { [tableName]: accountItems },
    });
    dynamoMock.on(TransactWriteItemsCommand).resolves({});
  });

  test("preserves native Accounting analytical posting fields and transaction behavior", async () => {
    await expect(
      LedgerService.postEntry({
        orgId: "org-a",
        userId: "user-1",
        data: analyticalEntry,
      }),
    ).resolves.toMatchObject({ entryId: expect.stringMatching(/^E-/) });

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
    const lines = transaction.TransactItems?.filter((item) => item.Put)
      .slice(1)
      .map((item) => unmarshall(item.Put?.Item ?? {}));
    expect(lines?.[0]).toMatchObject({
      accountId: "60100000",
      projectId: "PRJ-1",
      budgetLineId: "ACT-1",
      donorId: "DONOR-1",
      debit: 1000,
      credit: 0,
      GSI4PK: "ORG#org-a#PROJECTS_ALL",
    });
    expect(transaction.TransactItems).toHaveLength(5);
    expect(dynamoMock.commandCalls(BatchGetItemCommand)).toHaveLength(1);
  });

  test("rejects invalid Project references before any Accounting write", async () => {
    jest
      .mocked(ProjectAccountingReferenceService.validateAccountingReferences)
      .mockRejectedValueOnce(
        new AppError(400, "ERROR_ACCOUNT_OR_PROJECT_NOT_FOUND"),
      );

    await expect(
      LedgerService.postEntry({
        orgId: "org-a",
        userId: "user-1",
        data: analyticalEntry,
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      messageCode: "ERROR_ACCOUNT_OR_PROJECT_NOT_FOUND",
    });
    expect(dynamoMock.commandCalls(TransactWriteItemsCommand)).toHaveLength(0);
    expect(dynamoMock.commandCalls(BatchGetItemCommand)).toHaveLength(0);
  });

  test("keeps Accounting account validation before budget enforcement", async () => {
    dynamoMock.on(BatchGetItemCommand).resolves({ Responses: {} });

    await expect(
      LedgerService.postEntry({
        orgId: "org-a",
        userId: "user-1",
        data: analyticalEntry,
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      messageCode: "ERROR_ACCOUNT_OR_PROJECT_NOT_FOUND",
    });
    expect(
      ProjectAccountingReferenceService.validateAccountingReferences,
    ).toHaveBeenCalledTimes(1);
    expect(ProjectAccountingReferenceService.validatePostingLine).not.toHaveBeenCalled();
    expect(dynamoMock.commandCalls(TransactWriteItemsCommand)).toHaveLength(0);
  });
});
