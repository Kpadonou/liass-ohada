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
  unauthorized,
} from "@/models/shared/api-response";
import { BudgetLineSchema } from "@/models/projects/budget";

/**
 * @async
 * @function handler
 * @description Generates a Multi-Donor Analytical Report (SYCEBNL).
 * This report reconciles OHADA general accounting with project-based budgetary tracking.
 * It performs a multi-dimensional aggregation (Pivot Table) to show expenditures
 * cross-tabulated by Budget Line and Funding Source (Donor).
 * * Data Sources:
 * 1. Project Metadata (PROJECT item)
 * 2. Planned Budget (BUDGET_LINE items for the fiscal year)
 * 3. Funding Caps (FUNDING_SOURCE items for the project)
 * 4. Actual Transactions (ENTRY_LINE items retrieved via GSI4)
 * * @param {APIGatewayProxyEvent} event - Lambda event containing projectId and year.
 * @returns {Promise<APIGatewayProxyResult>} Analytical matrix and financial position.
 */
export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  const i18n = new I18nResolver(event.headers["Accept-Language"]);

  try {
    const orgId = event.requestContext?.authorizer?.claims?.orgId;
    if (!orgId) {
      return toLambdaResponse(unauthorized());
    }
    const projectId = event.pathParameters?.projectId;
    const reportYear = event.queryStringParameters?.year || "2026";

    if (!projectId) {
      return toLambdaResponse(
        badRequest(i18n.getMessage("ERROR_MISSING_PROJECT_ID")),
      );
    }

    // 1. Fetch Project Metadata
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

    // 2. Fetch Budget Lines (The "Plan")
    const budgetResult = await dynamoClient.send(
      new QueryCommand({
        TableName: config.TABLE_NAME,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
        ExpressionAttributeValues: marshall({
          ":pk": KeyFactory.orgKey(orgId),
          ":sk": `${KeyFactory.budgetSK(projectId, reportYear)}#L#`,
        }),
      }),
    );
    const budgetLines = (budgetResult.Items || []).map((item) =>
      BudgetLineSchema.parse(unmarshall(item)),
    );

    // 3. Fetch Funding Sources (The "Donor Envelopes/Promises")
    const fundingResult = await dynamoClient.send(
      new QueryCommand({
        TableName: config.TABLE_NAME,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
        ExpressionAttributeValues: marshall({
          ":pk": KeyFactory.orgKey(orgId),
          ":sk": `${KeyFactory.projectPrefix()}${projectId.toUpperCase()}#FS#`,
        }),
      }),
    );
    const fundingSources = (fundingResult.Items || []).map((item) =>
      unmarshall(item),
    );

    // 4. Fetch All Transactions via GSI4 (Actuals)
    const linesResult = await dynamoClient.send(
      new QueryCommand({
        TableName: config.TABLE_NAME,
        IndexName: config.GSI4,
        KeyConditionExpression: "GSI4PK = :pk AND begins_with(GSI4SK, :sk)",
        ExpressionAttributeValues: marshall({
          ":pk": KeyFactory.gsi4PK(orgId),
          ":sk": KeyFactory.projectYearPrefix(projectId, reportYear),
        }),
      }),
    );
    const allLines = (linesResult.Items || []).map((item) => unmarshall(item));

    // 5. Multi-dimensional Aggregation Logic
    let annualExpenses = 0;
    let annualResources = 0;

    const globalAccountMap = new Map<string, any>();
    const donorExecutionMatrix = new Map<string, Map<string, number>>();

    // ✨ NOUVEAU : Suivi de la trésorerie par bailleur
    // Map<donorId, { received: number, spent: number }>
    const donorCashflowMap = new Map<
      string,
      { received: number; spent: number }
    >();

    for (const line of allLines) {
      const debit = line.debit || 0;
      const credit = line.credit || 0;
      const donorId = line.donorId || "UNALLOCATED";

      annualExpenses += debit;
      annualResources += credit;

      // 5.1 Mise à jour du Cashflow par Bailleur (Encaissements vs Décaissements)
      const cashflow = donorCashflowMap.get(donorId) || {
        received: 0,
        spent: 0,
      };
      cashflow.received += credit; // Argent reçu du bailleur (comptes de produits/classe 7)
      cashflow.spent += debit; // Argent dépensé (comptes de charges/classe 6)
      donorCashflowMap.set(donorId, cashflow);

      // 5.2 General Ledger Aggregation (OHADA)
      const existingAcc = globalAccountMap.get(line.accountId) || {
        accountId: line.accountId,
        debit: 0,
        credit: 0,
      };
      existingAcc.debit += debit;
      existingAcc.credit += credit;
      globalAccountMap.set(line.accountId, existingAcc);

      // 5.3 Analytical Pivot (By Budget Line & Donor)
      if (line.budgetLineId && String(line.year) === String(reportYear)) {
        const lineMap =
          donorExecutionMatrix.get(line.budgetLineId) ||
          new Map<string, number>();
        lineMap.set(donorId, (lineMap.get(donorId) || 0) + debit);
        donorExecutionMatrix.set(line.budgetLineId, lineMap);
      }
    }

    // 6. Construction du Suivi des Financements (CASH)
    const fundingFollowUp = fundingSources.map((fs) => {
      const cash = donorCashflowMap.get(fs.donorId) || {
        received: 0,
        spent: 0,
      };
      const received = cash.received;
      const spent = cash.spent;

      return {
        donorId: fs.donorId,
        label: fs.label,
        promised: fs.amount,
        received: received,
        spent: spent,
        availableCash: received - spent,
        remainingToReceive: fs.amount - received,
        disbursementRate: fs.amount > 0 ? (received / fs.amount) * 100 : 0,
      };
    });

    // 7. Construct the Budget vs Actual Matrix
    const budgetVsActual = budgetLines.map((bl) => {
      const lineData = donorExecutionMatrix.get(bl.code);
      const breakdown: Record<string, number> = {};
      let lineTotalSpent = 0;

      fundingSources.forEach((fs) => {
        const amount = lineData?.get(fs.donorId) || 0;
        breakdown[fs.donorId] = amount;
        lineTotalSpent += amount;
      });

      const unallocated = lineData?.get("UNALLOCATED") || 0;
      lineTotalSpent += unallocated;

      return {
        code: bl.code,
        label: bl.label,
        allocated: bl.amount,
        donors: breakdown,
        unallocated,
        spent: lineTotalSpent,
        remaining: bl.amount - lineTotalSpent,
        executionRate: bl.amount > 0 ? (lineTotalSpent / bl.amount) * 100 : 0,
      };
    });

    // 8. Format OHADA Details
    const accountDetails = Array.from(globalAccountMap.values())
      .map((acc) => {
        const balance = acc.debit - acc.credit;
        return {
          ...acc,
          balance,
          formattedBalance:
            balance === 0
              ? "0"
              : `${Math.abs(balance).toLocaleString()} ${balance > 0 ? "D" : "C"}`,
        };
      })
      .sort((a, b) => a.accountId.localeCompare(b.accountId));

    return toLambdaResponse(
      ok(
        {
          projectInfo: {
            id: project.projectId,
            code: project.projectCode,
            name: project.name,
            donorList: fundingSources.map((fs) => ({
              id: fs.donorId,
              label: fs.label,
              budget: fs.amount,
            })),
          },
          financialPosition: {
            totalResources: annualResources,
            totalExpenses: annualExpenses,
            netCash: annualResources - annualExpenses,
          },
          fundingFollowUp, // ✨ Nouvelle section ajoutée
          budgetVsActual,
          accountDetails,
          metadata: {
            generatedAt: new Date().toISOString(),
            reportYear,
            organizationId: orgId,
          },
        },
        i18n.getMessage("SUCCESS_PROJECT_REPORT_RETRIEVED"),
      ),
    );
  } catch (error) {
    console.error("Project Report Error:", error);
    return toLambdaResponse(badRequest(i18n.getMessage("ERROR_INTERNAL")));
  }
};
