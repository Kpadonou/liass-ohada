import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { QueryCommand, GetItemCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { I18nResolver } from "../../../shared/i18n";
import {
  ok,
  badRequest,
  notFound,
  toLambdaResponse,
} from "../../../../models/shared/api-response";
import { dynamoClient } from "../../../shared/dynamo-client";
import { config } from "../../../shared/config";
import { KeyFactory } from "../../../shared/key-builder";

// Interface strictly for the Income Statement (Profit & Loss)
interface IncomeStatementResponse {
  fiscalYear: string;
  totalRevenue: number; // Class 7
  totalExpenses: number; // Class 6
  netResult: number; // Revenue - Expenses
  performanceStatus: "PROFIT" | "LOSS";
}

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const i18n = new I18nResolver(event.headers["Accept-Language"]);

  try {
    const orgId =
      event.requestContext.authorizer?.claims?.orgId || "test-org-001";
    const year = parseInt(
      event.queryStringParameters?.year || new Date().getFullYear().toString()
    );

    // 1. Validate fiscal year
    const fyResult = await dynamoClient.send(
      new GetItemCommand({
        TableName: config.TABLE_NAME,
        Key: {
          PK: { S: KeyFactory.orgKey(orgId) },
          SK: { S: `FY#${year}` },
        },
      })
    );

    if (!fyResult.Item) {
      return toLambdaResponse(
        notFound(i18n.getMessage("ERROR_FISCAL_YEAR_NOT_FOUND"))
      );
    }

    // 2. Aggregation Logic for Classes 6 and 7
    let totalExpenses = 0; // Class 6
    let totalRevenue = 0; // Class 7

    const fetchClassTotals = async (classPrefix: string) => {
      let lastEvaluatedKey: any = undefined;
      let classDebit = 0;
      let classCredit = 0;

      do {
        const queryResult = await dynamoClient.send(
          new QueryCommand({
            TableName: config.TABLE_NAME,
            IndexName: "GSI_ACCOUNT",
            KeyConditionExpression: "GSI1PK = :pk AND begins_with(GSI1SK, :sk)",
            ExpressionAttributeValues: {
              ":pk": { S: KeyFactory.gsiAccountPK(orgId) },
              ":sk": { S: `ACC#${classPrefix}` }, // ACC#6 or ACC#7
            },
            ExclusiveStartKey: lastEvaluatedKey,
          })
        );

        for (const item of queryResult.Items || []) {
          const line = unmarshall(item);
          // Check year explicitly from the year attribute (more robust)
          if (line.year === year) {
            classDebit += line.debit || 0;
            classCredit += line.credit || 0;
          }
        }
        lastEvaluatedKey = queryResult.LastEvaluatedKey;
      } while (lastEvaluatedKey);

      return { classDebit, classCredit };
    };

    // 3. Parallel execution for performance
    const [expensesData, revenueData] = await Promise.all([
      fetchClassTotals("6"),
      fetchClassTotals("7"),
    ]);

    // In OHADA:
    // Expenses = Debit - Credit (usually debit positive)
    // Revenue = Credit - Debit (usually credit positive)
    totalExpenses = expensesData.classDebit - expensesData.classCredit;
    totalRevenue = revenueData.classCredit - revenueData.classDebit;

    const netResult = totalRevenue - totalExpenses;

    const response: IncomeStatementResponse = {
      fiscalYear: year.toString(),
      totalRevenue,
      totalExpenses,
      netResult,
      performanceStatus: netResult >= 0 ? "PROFIT" : "LOSS",
    };

    return toLambdaResponse(
      ok(response, i18n.getMessage("SUCCESS_INCOME_STATEMENT_RETRIEVED"))
    );
  } catch (error) {
    console.error("Error in get-income-statement:", error);
    return toLambdaResponse(badRequest(i18n.getMessage("ERROR_INTERNAL")));
  }
};
