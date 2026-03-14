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
import { BudgetLineSchema } from "@/models/projects/budget";

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
    const orgId =
      event.requestContext.authorizer?.claims?.orgId || "org-test-dash";
    const projectId = event.pathParameters?.projectId;
    const reportYear = event.queryStringParameters?.year || "2026";

    if (!projectId)
      return toLambdaResponse(
        badRequest(i18n.getMessage("ERROR_MISSING_PROJECT_ID")),
      );

    // 1. Fetch Metadata (Project)
    const projectResult = await dynamoClient.send(
      new GetItemCommand({
        TableName: config.TABLE_NAME,
        Key: marshall({
          PK: KeyFactory.orgKey(orgId),
          SK: KeyFactory.projectSK(projectId),
        }),
      }),
    );
    if (!projectResult.Item)
      return toLambdaResponse(
        notFound(i18n.getMessage("ERROR_PROJECT_NOT_FOUND")),
      );
    const project = ProjectSchema.parse(unmarshall(projectResult.Item));

    // 2. Query ALL Budget Lines (Le Prévu)
    const budgetResult = await dynamoClient.send(
      new QueryCommand({
        TableName: config.TABLE_NAME,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
        ExpressionAttributeValues: {
          ":pk": { S: KeyFactory.orgKey(orgId) },
          ":sk": { S: `PRJ#${projectId}#BDG#${reportYear}#L#` },
        },
      }),
    );
    const budgetLines = (budgetResult.Items || []).map((item) => {
      const data = unmarshall(item);
      return BudgetLineSchema.parse(data);
    });

    // 3. Query Transactions via GSI4 (Le Réalisé)
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

    // 4. Aggregation Logic
    let annualEmplois = 0;
    let globalEmplois = 0;
    let globalRessources = 0;

    const globalAccountMap = new Map<string, any>();
    const budgetExecutionMap = new Map<string, number>(); // Map: budgetLineId -> totalSpent

    for (const line of allLines) {
      const debit = line.debit || 0;
      const credit = line.credit || 0;

      globalEmplois += debit;
      globalRessources += credit;
      if (line.fiscalYear === reportYear) annualEmplois += debit;

      // Agrégation par Compte (Comptabilité Générale)
      const existingAcc = globalAccountMap.get(line.accountId) || {
        accountId: line.accountId,
        debit: 0,
        credit: 0,
      };
      existingAcc.debit += debit;
      existingAcc.credit += credit;
      globalAccountMap.set(line.accountId, existingAcc);

      // Agrégation par Ligne Budgétaire (Comptabilité Analytique)
      if (line.budgetLineId) {
        const currentSpent = budgetExecutionMap.get(line.budgetLineId) || 0;
        budgetExecutionMap.set(line.budgetLineId, currentSpent + debit);
      }
    }

    // 5. Build Budget vs Actual Report
    const analyticalReport = budgetLines.map((bl) => {
      const spent = budgetExecutionMap.get(bl.code) || 0;
      return {
        code: bl.code,
        label: bl.label,
        allocated: bl.amount,
        spent: spent,
        remaining: bl.amount - spent,
        executionRate: bl.amount > 0 ? (spent / bl.amount) * 100 : 0,
      };
    });

    // 6. Format Detailed Accounts (avec D/C)
    const detailedAccounts = Array.from(globalAccountMap.values())
      .map((acc) => {
        const bal = acc.debit - acc.credit;
        return {
          ...acc,
          balance: bal,
          formattedBalance:
            bal === 0
              ? "0"
              : `${Math.abs(bal).toLocaleString()} ${bal > 0 ? "D" : "C"}`,
        };
      })
      .sort((a, b) => a.accountId.localeCompare(b.accountId));

    // 7. Final Structure
    return toLambdaResponse(
      ok(
        {
          projectInfo: {
            id: project.projectId,
            code: project.projectCode,
            name: project.name,
            donor: project.donorId,
          },
          financialPosition: {
            totalRessources: globalRessources,
            totalEmplois: globalEmplois,
            netCash: globalRessources - globalEmplois,
          },
          // LA NOUVELLE SECTION ANALYTIQUE
          budgetVsActual: analyticalReport,
          // LA SECTION COMPTABLE
          accountDetails: detailedAccounts,
          metadata: { generatedAt: new Date().toISOString() },
        },
        i18n.getMessage("SUCCESS_PROJECT_REPORT_RETRIEVED"),
      ),
    );
  } catch (error) {
    console.error("Report Error:", error);
    return toLambdaResponse(badRequest(i18n.getMessage("ERROR_INTERNAL")));
  }
};
