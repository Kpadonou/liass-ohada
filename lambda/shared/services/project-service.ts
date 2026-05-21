import { config } from "@/lambda/shared/config";
import { dynamoClient } from "@/lambda/shared/dynamo-client";
import { KeyFactory } from "@/lambda/shared/key-builder";
import { AppError } from "@/lambda/shared/middleware/handler-wrapper";
import { BudgetLineSchema } from "@/models/projects/budget";
import { FundingSourceSchema } from "@/models/projects/funding-source";
import { Project, ProjectSchema } from "@/models/projects/project";
import {
  GetItemCommand,
  QueryCommand,
  TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { randomUUID } from "crypto";
import { z } from "zod";

export const CreateProjectInputSchema = ProjectSchema.omit({
  orgId: true,
  projectId: true,
  currentSpending: true,
  entityType: true,
  createdAt: true,
  updatedAt: true,
});

export const CreateFundingSourceInputSchema = z.object({
  donorId: z.string().min(1),
  label: z.string().min(1),
  amount: z.number().int().nonnegative(),
  currency: z.string().length(3).default("XOF"),
});

export type CreateProjectInput = z.infer<typeof CreateProjectInputSchema>;
export type CreateFundingSourceInput = z.infer<
  typeof CreateFundingSourceInputSchema
>;

export class ProjectService {
  static async createProject(
    orgId: string,
    userId: string,
    input: CreateProjectInput,
  ) {
    const now = new Date().toISOString();
    const projectId = `PRJ-${randomUUID()}`;

    await ProjectService.assertDonorExists(orgId, input.donorId);

    const project = ProjectSchema.parse({
      ...input,
      orgId,
      projectId,
      currentSpending: 0,
      entityType: "PROJECT",
      createdAt: now,
      updatedAt: now,
    });

    const projectItem = {
      PK: KeyFactory.orgKey(orgId),
      SK: KeyFactory.projectSK(projectId),
      ...project,
      createdBy: userId,
      updatedBy: userId,
    };

    const projectCodeLock = {
      PK: KeyFactory.orgKey(orgId),
      SK: KeyFactory.projectCodeSK(project.projectCode),
      projectId,
      entityType: "PROJECT_CODE_LOCK",
      createdBy: userId,
      createdAt: now,
    };

    try {
      await dynamoClient.send(
        new TransactWriteItemsCommand({
          TransactItems: [
            {
              Put: {
                TableName: config.TABLE_NAME,
                Item: marshall(projectItem, { removeUndefinedValues: true }),
                ConditionExpression:
                  "attribute_not_exists(PK) AND attribute_not_exists(SK)",
              },
            },
            {
              Put: {
                TableName: config.TABLE_NAME,
                Item: marshall(projectCodeLock),
                ConditionExpression:
                  "attribute_not_exists(PK) AND attribute_not_exists(SK)",
              },
            },
          ],
        }),
      );
    } catch (error: any) {
      if (error?.name === "TransactionCanceledException") {
        throw new AppError(400, "ERROR_PROJECT_CODE_EXISTS");
      }
      throw error;
    }

    return projectItem;
  }

  static async listProjects(orgId: string): Promise<Project[]> {
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: config.TABLE_NAME,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
        ExpressionAttributeValues: marshall({
          ":pk": KeyFactory.orgKey(orgId),
          ":sk": KeyFactory.projectPrefix(),
        }),
      }),
    );

    return (result.Items || [])
      .map((item) => unmarshall(item))
      .filter((item) => item.entityType === "PROJECT")
      .map((item) => ProjectSchema.parse(item));
  }

  static async getProject(orgId: string, projectId: string): Promise<Project> {
    const result = await dynamoClient.send(
      new GetItemCommand({
        TableName: config.TABLE_NAME,
        Key: marshall({
          PK: KeyFactory.orgKey(orgId),
          SK: KeyFactory.projectSK(projectId),
        }),
      }),
    );

    if (!result.Item) {
      throw new AppError(404, "ERROR_PROJECT_NOT_FOUND");
    }

    return ProjectSchema.parse(unmarshall(result.Item));
  }

  static async createFundingSource(
    orgId: string,
    userId: string,
    projectId: string,
    input: CreateFundingSourceInput,
  ) {
    const now = new Date().toISOString();
    await ProjectService.getProject(orgId, projectId);
    await ProjectService.assertDonorExists(orgId, input.donorId);

    const fundingSource = {
      PK: KeyFactory.orgKey(orgId),
      SK: KeyFactory.fundingSourceSK(projectId, input.donorId),
      entityType: "FUNDING_SOURCE",
      projectId,
      donorId: input.donorId,
      label: input.label,
      amount: input.amount,
      currency: input.currency,
      createdBy: userId,
      createdAt: now,
      updatedBy: userId,
      updatedAt: now,
    };

    try {
      await dynamoClient.send(
        new TransactWriteItemsCommand({
          TransactItems: [
            {
              Put: {
                TableName: config.TABLE_NAME,
                Item: marshall(fundingSource, { removeUndefinedValues: true }),
                ConditionExpression:
                  "attribute_not_exists(PK) AND attribute_not_exists(SK)",
              },
            },
          ],
        }),
      );
    } catch (error: any) {
      if (error?.name === "TransactionCanceledException") {
        throw new AppError(400, "ERROR_FUNDING_SOURCE_EXISTS");
      }
      throw error;
    }

    return fundingSource;
  }

  static async listFundingSources(orgId: string, projectId: string) {
    await ProjectService.getProject(orgId, projectId);

    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: config.TABLE_NAME,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
        ExpressionAttributeValues: marshall({
          ":pk": KeyFactory.orgKey(orgId),
          ":sk": KeyFactory.fundingSourcesPrefix(projectId),
        }),
      }),
    );

    return (result.Items || []).map((item) =>
      FundingSourceSchema.passthrough().parse(unmarshall(item)),
    );
  }

  static async getProjectReport(
    orgId: string,
    projectId: string,
    reportYear: string,
  ) {
    const project = await ProjectService.getProject(orgId, projectId);
    const [budgetLines, fundingSources, allLines] = await Promise.all([
      ProjectService.listBudgetLines(orgId, projectId, reportYear),
      ProjectService.listFundingSources(orgId, projectId),
      ProjectService.listProjectLines(orgId, projectId, reportYear),
    ]);

    let annualExpenses = 0;
    let annualResources = 0;
    const globalAccountMap = new Map<string, any>();
    const donorExecutionMatrix = new Map<string, Map<string, number>>();
    const donorCashflowMap = new Map<
      string,
      { received: number; spent: number }
    >();

    for (const line of allLines) {
      const debit = Number(line.debit) || 0;
      const credit = Number(line.credit) || 0;
      const donorId = line.donorId || "UNALLOCATED";

      annualExpenses += debit;
      annualResources += credit;

      const cashflow = donorCashflowMap.get(donorId) || {
        received: 0,
        spent: 0,
      };
      cashflow.received += credit;
      cashflow.spent += debit;
      donorCashflowMap.set(donorId, cashflow);

      const account = globalAccountMap.get(line.accountId) || {
        accountId: line.accountId,
        debit: 0,
        credit: 0,
      };
      account.debit += debit;
      account.credit += credit;
      globalAccountMap.set(line.accountId, account);

      if (line.budgetLineId && String(line.year) === String(reportYear)) {
        const lineMap =
          donorExecutionMatrix.get(line.budgetLineId) ||
          new Map<string, number>();
        lineMap.set(donorId, (lineMap.get(donorId) || 0) + debit);
        donorExecutionMatrix.set(line.budgetLineId, lineMap);
      }
    }

    const fundingFollowUp = fundingSources.map((source) => {
      const cash = donorCashflowMap.get(source.donorId) || {
        received: 0,
        spent: 0,
      };

      return {
        donorId: source.donorId,
        label: source.label,
        promised: source.amount,
        received: cash.received,
        spent: cash.spent,
        availableCash: cash.received - cash.spent,
        remainingToReceive: source.amount - cash.received,
        disbursementRate:
          source.amount > 0 ? (cash.received / source.amount) * 100 : 0,
      };
    });

    const budgetVsActual = budgetLines.map((budgetLine) => {
      const lineData = donorExecutionMatrix.get(budgetLine.code);
      const breakdown: Record<string, number> = {};
      let lineTotalSpent = 0;

      fundingSources.forEach((source) => {
        const amount = lineData?.get(source.donorId) || 0;
        breakdown[source.donorId] = amount;
        lineTotalSpent += amount;
      });

      const unallocated = lineData?.get("UNALLOCATED") || 0;
      lineTotalSpent += unallocated;

      return {
        code: budgetLine.code,
        label: budgetLine.label,
        allocated: budgetLine.amount,
        donors: breakdown,
        unallocated,
        spent: lineTotalSpent,
        remaining: budgetLine.amount - lineTotalSpent,
        executionRate:
          budgetLine.amount > 0 ? (lineTotalSpent / budgetLine.amount) * 100 : 0,
      };
    });

    const accountDetails = Array.from(globalAccountMap.values())
      .map((account) => {
        const balance = account.debit - account.credit;
        return {
          ...account,
          balance,
          formattedBalance:
            balance === 0
              ? "0"
              : `${Math.abs(balance).toLocaleString()} ${balance > 0 ? "D" : "C"}`,
        };
      })
      .sort((a, b) => a.accountId.localeCompare(b.accountId));

    return {
      projectInfo: {
        id: project.projectId,
        code: project.projectCode,
        name: project.name,
        donorList: fundingSources.map((source) => ({
          id: source.donorId,
          label: source.label,
          budget: source.amount,
        })),
      },
      financialPosition: {
        totalResources: annualResources,
        totalExpenses: annualExpenses,
        netCash: annualResources - annualExpenses,
      },
      fundingFollowUp,
      budgetVsActual,
      accountDetails,
      metadata: {
        generatedAt: new Date().toISOString(),
        reportYear,
        organizationId: orgId,
      },
    };
  }

  static async getProjectsSummary(orgId: string, currentYear: string) {
    const [projects, allLines] = await Promise.all([
      ProjectService.listProjects(orgId),
      ProjectService.listAllProjectLines(orgId),
    ]);

    return projects.map((project) => {
      const projectLines = allLines.filter(
        (line) =>
          line.projectId === project.projectId ||
          String(line.GSI4SK || "").includes(project.projectId),
      );

      let totalEmplois = 0;
      let totalRessources = 0;
      let annualEmplois = 0;

      for (const line of projectLines) {
        const debit = Number(line.debit) || 0;
        const credit = Number(line.credit) || 0;

        totalEmplois += debit;
        totalRessources += credit;

        if (String(line.year) === String(currentYear)) {
          annualEmplois += debit;
        }
      }

      const annualBudget = project.annualBudgets?.[currentYear] || 0;

      return {
        projectInfo: {
          id: project.projectId,
          code: project.projectCode,
          name: project.name,
          donor: project.donorId,
          status: project.status,
        },
        financials: {
          netPosition: totalRessources - totalEmplois,
          globalExecutionRate:
            project.totalBudget > 0 ? (totalEmplois / project.totalBudget) * 100 : 0,
          annualExecutionRate:
            annualBudget > 0 ? (annualEmplois / annualBudget) * 100 : 0,
        },
        alerts: {
          isOverSpentGlobal: totalEmplois > project.totalBudget,
          isOverSpentAnnual: annualEmplois > annualBudget,
          isCashNegative: totalRessources - totalEmplois < 0,
        },
      };
    });
  }

  private static async assertDonorExists(orgId: string, donorId: string) {
    const result = await dynamoClient.send(
      new GetItemCommand({
        TableName: config.TABLE_NAME,
        Key: marshall({
          PK: KeyFactory.orgKey(orgId),
          SK: KeyFactory.thirdPartySK("DONOR", donorId),
        }),
      }),
    );

    if (!result.Item) {
      throw new AppError(400, "ERROR_DONOR_NOT_FOUND");
    }
  }

  private static async listBudgetLines(
    orgId: string,
    projectId: string,
    year: string,
  ) {
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: config.TABLE_NAME,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
        ExpressionAttributeValues: marshall({
          ":pk": KeyFactory.orgKey(orgId),
          ":sk": KeyFactory.budgetLinesPrefix(projectId, year),
        }),
      }),
    );

    return (result.Items || []).map((item) =>
      BudgetLineSchema.passthrough().parse(unmarshall(item)),
    );
  }

  private static async listProjectLines(
    orgId: string,
    projectId: string,
    year: string,
  ) {
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: config.TABLE_NAME,
        IndexName: config.GSI4,
        KeyConditionExpression: "GSI4PK = :pk AND begins_with(GSI4SK, :sk)",
        ExpressionAttributeValues: marshall({
          ":pk": KeyFactory.gsi4PK(orgId),
          ":sk": KeyFactory.projectYearPrefix(projectId, year),
        }),
      }),
    );

    return (result.Items || []).map((item) => unmarshall(item));
  }

  private static async listAllProjectLines(orgId: string) {
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: config.TABLE_NAME,
        IndexName: config.GSI4,
        KeyConditionExpression: "GSI4PK = :pk",
        ExpressionAttributeValues: marshall({
          ":pk": KeyFactory.gsi4PK(orgId),
        }),
      }),
    );

    return (result.Items || []).map((item) => unmarshall(item));
  }
}
