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
 * @async
 * @function handler
 * @description Generates the full Hybrid Analytical Report (TER).
 * Restores the global account breakdown while keeping annual budget performance.
 */
export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  const i18n = new I18nResolver(event.headers["Accept-Language"]);

  try {
    const orgId = event.requestContext.authorizer?.claims?.orgId;
    const projectId = event.pathParameters?.projectId;
    const reportYear = event.queryStringParameters?.year || "2026";

    if (!projectId) {
      return toLambdaResponse(
        badRequest(i18n.getMessage("ERROR_MISSING_PROJECT_ID")),
      );
    }

    // 1. Fetch Metadata
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

    // 2. Query ALL project lines (Global)
    const linesResult = await dynamoClient.send(
      new QueryCommand({
        TableName: config.TABLE_NAME,
        IndexName: "GSI_PROJECT",
        KeyConditionExpression: "GSI4PK = :pk AND begins_with(GSI4SK, :sk)",
        ExpressionAttributeValues: {
          ":pk": { S: KeyFactory.gsi4PK(orgId) },
          ":sk": { S: `PRJ#${projectId}#` },
        },
      }),
    );

    const allLines = (linesResult.Items || []).map((item) => unmarshall(item));

    // 3. Aggregation Logic
    let annualEmplois = 0;
    let globalEmplois = 0;
    let globalRessources = 0;

    // We keep a Global account breakdown (as in your previous version)
    const globalAccountMap = new Map<
      string,
      { accountId: string; debit: number; credit: number; balance: number }
    >();

    for (const line of allLines) {
      const debit = line.debit || 0;
      const credit = line.credit || 0;

      // LTD (Life-to-Date) calculations
      globalEmplois += debit;
      globalRessources += credit;

      // Yearly filter for budget performance only
      if (line.fiscalYear === reportYear) {
        annualEmplois += debit;
      }

      // Restore Account Breakdown (Global view)
      const existing = globalAccountMap.get(line.accountId) || {
        accountId: line.accountId,
        debit: 0,
        credit: 0,
        balance: 0,
      };
      existing.debit += debit;
      existing.credit += credit;
      existing.balance = existing.debit - existing.credit;
      globalAccountMap.set(line.accountId, existing);
    }

    const annualBudget = project.annualBudgets?.[reportYear] || 0;

    const detailedLines = Array.from(globalAccountMap.values())
      .map((acc) => {
        const balance = acc.debit - acc.credit;
        return {
          accountId: acc.accountId,
          debit: acc.debit,
          credit: acc.credit,
          balance: balance, // On garde le brut pour le dev
          // Voici la clé pour l'utilisateur final :
          formattedBalance:
            balance === 0
              ? "0"
              : `${Math.abs(balance).toLocaleString()} ${balance > 0 ? "D" : "C"}`,
        };
      })
      .sort((a, b) => a.accountId.localeCompare(b.accountId));

    // 4. Final Hybrid Report Structure
    const report = {
      projectInfo: {
        id: project.projectId,
        code: project.projectCode,
        name: project.name,
        donor: project.donorId,
      },
      // Restored: The clear financial position summary (Global)
      terSummary: {
        totalRessources: globalRessources, // "💰 RESSOURCES"
        totalEmplois: globalEmplois, // "💸 EMPLOIS"
        netPosition: globalRessources - globalEmplois, // "📊 POSITION NETTE"
      },
      // The new SaaS "Executive" view
      budgetPerformance: {
        annual: {
          year: reportYear,
          budget: annualBudget,
          spent: annualEmplois,
          executionRate:
            annualBudget > 0 ? (annualEmplois / annualBudget) * 100 : 0,
        },
        global: {
          totalBudget: project.totalBudget,
          totalSpent: globalEmplois,
          executionRate:
            project.totalBudget > 0
              ? (globalEmplois / project.totalBudget) * 100
              : 0,
        },
      },
      // Restored: "🔍 DÉTAILS PAR COMPTE"
      details: detailedLines,
      metadata: {
        generatedAt: new Date().toISOString(),
      },
    };

    return toLambdaResponse(
      ok(report, i18n.getMessage("SUCCESS_PROJECT_REPORT_RETRIEVED")),
    );
  } catch (error) {
    console.error("HybridReport Error:", error);
    return toLambdaResponse(badRequest(i18n.getMessage("ERROR_INTERNAL")));
  }
};
