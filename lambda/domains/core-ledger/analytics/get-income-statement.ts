import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { QueryCommand, GetItemCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall, marshall } from "@aws-sdk/util-dynamodb";
import { I18nResolver } from "@/lambda/shared/i18n";
import {
  ok,
  badRequest,
  notFound,
  toLambdaResponse,
} from "@/models/shared/api-response";
import { dynamoClient } from "@/lambda/shared/dynamo-client";
import { config } from "@/lambda/shared/config";
import { KeyFactory } from "@/lambda/shared/key-builder";

/**
 * Simplified Income Statement (P&L) structure.
 */
interface IncomeStatementResponse {
  fiscalYear: string;
  totalRevenue: number; // Class 7 - Products
  totalExpenses: number; // Class 6 - Charges
  netResult: number; // Revenue - Expenses
  performanceStatus: "PROFIT" | "LOSS";
}

/**
 * Generates the Income Statement for a given fiscal year.
 * Aggregates all movements from account classes 6 and 7 to determine
 * the operational performance (Profit or Loss).
 */
export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  const i18n = new I18nResolver(event.headers["Accept-Language"]);

  try {
    const orgId = event.requestContext.authorizer?.claims?.orgId;
    const year = parseInt(
      event.queryStringParameters?.year || new Date().getFullYear().toString(),
    );

    // 1. Validate fiscal year existence
    const fyResult = await dynamoClient.send(
      new GetItemCommand({
        TableName: config.TABLE_NAME,
        Key: marshall({
          PK: KeyFactory.orgKey(orgId),
          SK: KeyFactory.fiscalYearSK(year),
        }),
      }),
    );

    if (!fyResult.Item) {
      return toLambdaResponse(
        notFound(i18n.getMessage("ERROR_FISCAL_YEAR_NOT_FOUND")),
      );
    }

    /**
     * Helper to fetch totals for a specific account class prefix (e.g., '6' or '7').
     */
    const fetchClassTotals = async (classPrefix: string) => {
      let lastEvaluatedKey: any = undefined;
      let classDebit = 0;
      let classCredit = 0;

      do {
        const queryResult = await dynamoClient.send(
          new QueryCommand({
            TableName: config.TABLE_NAME,
            IndexName: config.GSI_ACCOUNT,
            KeyConditionExpression: "GSI1PK = :pk AND begins_with(GSI1SK, :sk)",
            ExpressionAttributeValues: marshall({
              ":pk": KeyFactory.gsi1PK(orgId),
              ":sk": `ACC#${classPrefix}`, // Filtering by account class prefix
            }),
            ExclusiveStartKey: lastEvaluatedKey,
          }),
        );

        for (const item of queryResult.Items || []) {
          const line = unmarshall(item);
          // Safety check: ensure the line belongs to the requested fiscal year
          if (Number(line.year) === year) {
            classDebit += Number(line.debit) || 0;
            classCredit += Number(line.credit) || 0;
          }
        }
        lastEvaluatedKey = queryResult.LastEvaluatedKey;
      } while (lastEvaluatedKey);

      return { classDebit, classCredit };
    };

    // 2. Parallel aggregation of Expenses (6) and Revenue (7)
    const [expensesData, revenueData] = await Promise.all([
      fetchClassTotals("6"),
      fetchClassTotals("7"),
    ]);

    // 3. SYSCOHADA Logic:
    // Expenses (Class 6) are typically Debit balances: Debit - Credit
    // Revenue (Class 7) are typically Credit balances: Credit - Debit
    const totalExpenses = expensesData.classDebit - expensesData.classCredit;
    const totalRevenue = revenueData.classCredit - revenueData.classDebit;

    const netResult = totalRevenue - totalExpenses;

    const response: IncomeStatementResponse = {
      fiscalYear: year.toString(),
      totalRevenue,
      totalExpenses,
      netResult,
      performanceStatus: netResult >= 0 ? "PROFIT" : "LOSS",
    };

    return toLambdaResponse(
      ok(response, i18n.getMessage("SUCCESS_INCOME_STATEMENT_RETRIEVED")),
    );
  } catch (error) {
    console.error("Error in get-income-statement:", error);
    return toLambdaResponse(badRequest(i18n.getMessage("ERROR_INTERNAL")));
  }
};
