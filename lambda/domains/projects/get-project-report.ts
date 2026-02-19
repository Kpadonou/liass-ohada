import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { QueryCommand, GetItemCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall, marshall } from "@aws-sdk/util-dynamodb";
import { dynamoClient } from "@/lambda/shared/dynamo-client";
import { config } from "@/lambda/shared/config";
import { KeyFactory } from "@/lambda/shared/key-builder";
import { I18nResolver } from "@/lambda/shared/i18n";
import { ProjectSchema } from "@/models/projects/project";
import {
  toLambdaResponse,
  ok,
  badRequest,
  notFound,
} from "@/models/shared/api-response";

/**
 * Generates an analytical financial report for a specific project.
 * Fetches project metadata and aggregates all linked accounting lines from GSI4.
 * Provides a global budget overview and a detailed breakdown by account.
 * * @param event - APIGatewayProxyEvent with projectId in pathParameters.
 * @returns APIGatewayProxyResult with the analytical report data.
 */
export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  const i18n = new I18nResolver(event.headers["Accept-Language"]);

  try {
    const orgId = event.requestContext.authorizer?.claims?.orgId || "test-org";
    const projectId = event.pathParameters?.projectId;

    if (!projectId) {
      return toLambdaResponse(
        badRequest(i18n.getMessage("ERROR_MISSING_PROJECT_ID")),
      );
    }

    // 1. Fetch Project Metadata (Budget, Donor, etc.)
    const projectResult = await dynamoClient.send(
      new GetItemCommand({
        TableName: config.TABLE_NAME,
        Key: marshall({
          PK: KeyFactory.orgKey(orgId),
          SK: KeyFactory.projectSK(projectId),
        }),
      }),
    );

    if (!projectResult.Item) {
      return toLambdaResponse(
        notFound(i18n.getMessage("ERROR_PROJECT_NOT_FOUND")),
      );
    }

    const project = ProjectSchema.parse(unmarshall(projectResult.Item));

    // 2. Query all accounting transactions linked to this project via GSI4
    const linesResult = await dynamoClient.send(
      new QueryCommand({
        TableName: config.TABLE_NAME,
        IndexName: "GSI_PROJECT",
        KeyConditionExpression: "GSI4PK = :pk",
        ExpressionAttributeValues: {
          ":pk": { S: KeyFactory.gsi4PK(orgId, projectId) },
        },
      }),
    );

    const lines = (linesResult.Items || []).map((item) => unmarshall(item));

    // 3. Aggregate Actuals and Build Account Breakdown
    let totalDebit = 0;
    let totalCredit = 0;
    const accountMap = new Map<
      string,
      { accountId: string; debit: number; credit: number; net: number }
    >();

    for (const line of lines) {
      const accId = line.accountId;
      const debit = line.debit || 0;
      const credit = line.credit || 0;

      totalDebit += debit;
      totalCredit += credit;

      // Group by Account ID
      const existing = accountMap.get(accId) || {
        accountId: accId,
        debit: 0,
        credit: 0,
        net: 0,
      };
      existing.debit += debit;
      existing.credit += credit;
      existing.net = existing.debit - existing.credit;

      accountMap.set(accId, existing);
    }

    const actualSpending = totalDebit - totalCredit;

    // 4. Build Final Analytical Report
    const report = {
      projectInfo: {
        projectId: project.projectId,
        projectCode: project.projectCode,
        name: project.name,
        donorId: project.donorId,
        managerId: project.managerId,
        currency: project.currency,
        status: project.status,
      },
      budgetOverview: {
        allocated: project.budget,
        actual: actualSpending,
        remaining: project.budget - actualSpending,
        consumptionPercentage:
          project.budget > 0
            ? Number(((actualSpending / project.budget) * 100).toFixed(2))
            : 0,
      },
      accountBreakdown: Array.from(accountMap.values()).sort((a, b) =>
        a.accountId.localeCompare(b.accountId),
      ),
      metadata: {
        transactionCount: lines.length,
        generatedAt: new Date().toISOString(),
      },
    };

    return toLambdaResponse(
      ok(report, i18n.getMessage("SUCCESS_PROJECT_REPORT_RETRIEVED")),
    );
  } catch (error) {
    console.error("GetProjectReport Error:", error);
    return toLambdaResponse(badRequest(i18n.getMessage("ERROR_INTERNAL")));
  }
};
