import { ProjectAccountingReferenceService } from "@/lambda/domains/projects/references/project-accounting-reference-service";
import { AppError } from "@/lambda/shared/middleware/handler-wrapper";
import { BudgetService } from "@/lambda/domains/projects/services/budget-service";
import {
  BatchGetItemCommand,
  DynamoDBClient,
} from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { mockClient } from "aws-sdk-client-mock";

const dynamoMock = mockClient(DynamoDBClient);
const tableName = "liass-ohada-test-accounting-table";

jest.mock("@/lambda/domains/projects/services/budget-service", () => ({
  BudgetService: {
    enforceBudget: jest.fn(),
  },
}));

describe("ProjectAccountingReferenceService", () => {
  beforeEach(() => {
    dynamoMock.reset();
    jest.clearAllMocks();
  });

  test("validates unique tenant-scoped project references with one BatchGet", async () => {
    dynamoMock.on(BatchGetItemCommand).resolves({
      Responses: {
        [tableName]: [
          marshall({
            PK: "ORG#org-a",
            SK: "PRJ#PRJ-1",
            entityType: "PROJECT",
            projectId: "PRJ-1",
          }),
          marshall({
            PK: "ORG#org-a",
            SK: "PRJ#PRJ-2",
            entityType: "PROJECT",
            projectId: "PRJ-2",
            status: "CANCELLED",
          }),
        ],
      },
    });

    await expect(
      ProjectAccountingReferenceService.validateAccountingReferences({
        orgId: "org-a",
        projectIds: ["PRJ-1", "PRJ-1", "PRJ-2"],
      }),
    ).resolves.toBeUndefined();

    const request = dynamoMock.commandCalls(BatchGetItemCommand)[0].args[0].input;
    expect(request.RequestItems?.[tableName]?.Keys).toEqual([
      marshall({ PK: "ORG#org-a", SK: "PRJ#PRJ-1" }),
      marshall({ PK: "ORG#org-a", SK: "PRJ#PRJ-2" }),
    ]);
    expect(dynamoMock.commandCalls(BatchGetItemCommand)).toHaveLength(1);
  });

  test("preserves the missing-project error and rejects another tenant's row", async () => {
    dynamoMock.on(BatchGetItemCommand).resolves({
      Responses: {
        [tableName]: [
          marshall({
            PK: "ORG#org-b",
            SK: "PRJ#PRJ-1",
            entityType: "PROJECT",
            projectId: "PRJ-1",
          }),
        ],
      },
    });

    await expect(
      ProjectAccountingReferenceService.validateAccountingReferences({
        orgId: "org-a",
        projectIds: ["PRJ-1"],
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      messageCode: "ERROR_ACCOUNT_OR_PROJECT_NOT_FOUND",
    });
  });

  test("performs no persistence read when no project is referenced", async () => {
    await expect(
      ProjectAccountingReferenceService.validateAccountingReferences({
        orgId: "org-a",
        projectIds: [],
      }),
    ).resolves.toBeUndefined();

    expect(dynamoMock.commandCalls(BatchGetItemCommand)).toHaveLength(0);
  });

  test("delegates the existing budget and donor-cash validation only for project debits", async () => {
    await ProjectAccountingReferenceService.validatePostingLine({
      orgId: "org-a",
      year: 2026,
      projectId: "PRJ-1",
      budgetLineId: "ACT-1",
      donorId: "DONOR-1",
      debit: 500,
      credit: 0,
    });
    await ProjectAccountingReferenceService.validatePostingLine({
      orgId: "org-a",
      year: 2026,
      projectId: "PRJ-1",
      debit: 0,
      credit: 500,
    });
    await ProjectAccountingReferenceService.validatePostingLine({
      orgId: "org-a",
      year: 2026,
      debit: 500,
      credit: 0,
    });

    expect(BudgetService.enforceBudget).toHaveBeenCalledTimes(1);
    expect(BudgetService.enforceBudget).toHaveBeenCalledWith("org-a", 2026, {
      orgId: "org-a",
      year: 2026,
      projectId: "PRJ-1",
      budgetLineId: "ACT-1",
      donorId: "DONOR-1",
      debit: 500,
      credit: 0,
    });
  });

  test("propagates existing Project Accounting budget errors unchanged", async () => {
    jest
      .mocked(BudgetService.enforceBudget)
      .mockRejectedValueOnce(
        new AppError(400, "ERROR_BUDGET_LINE_EXCEEDED", { available: 100 }),
      );

    await expect(
      ProjectAccountingReferenceService.validatePostingLine({
        orgId: "org-a",
        year: 2026,
        projectId: "PRJ-1",
        budgetLineId: "ACT-1",
        debit: 500,
        credit: 0,
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      messageCode: "ERROR_BUDGET_LINE_EXCEEDED",
    });
  });
});
