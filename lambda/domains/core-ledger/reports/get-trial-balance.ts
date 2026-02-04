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

// Interface for the final trial balance lines
interface TrialBalanceItem {
  accountId: string;
  accountName: string;
  accountNature: string;
  totalDebit: number;
  totalCredit: number;
  debitBalance: number;
  creditBalance: number;
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

    // 1. Validate fiscal year existence
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

    // 2. Fetch all Accounts (Master Data) for the organization
    const accountsQuery = await dynamoClient.send(
      new QueryCommand({
        TableName: config.TABLE_NAME,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
        ExpressionAttributeValues: {
          ":pk": { S: KeyFactory.orgKey(orgId) },
          ":sk": { S: "ACC#" },
        },
      })
    );

    const allAccounts =
      accountsQuery.Items?.map((item) => unmarshall(item)) || [];

    // 3. Aggregate transaction totals for each account using GSI-Account
    // We use Promise.all to fetch balances in parallel for better performance
    const aggregates: Record<string, { debit: number; credit: number }> = {};

    await Promise.all(
      allAccounts.map(async (account) => {
        const accountId = account.accountId;
        let lastEvaluatedKey: any = undefined;
        let accDebit = 0;
        let accCredit = 0;

        do {
          const queryResult = await dynamoClient.send(
            new QueryCommand({
              TableName: config.TABLE_NAME,
              IndexName: "GSI-Account",
              KeyConditionExpression:
                "GSI1PK = :pk AND begins_with(GSI1SK, :gsi1sk)",
              ExpressionAttributeValues: {
                ":pk": { S: KeyFactory.orgKey(orgId) },
                ":gsi1sk": { S: `ACC#${accountId}#FY#${year}#` },
              },
              ExclusiveStartKey: lastEvaluatedKey,
            })
          );

          for (const item of queryResult.Items || []) {
            const line = unmarshall(item);
            accDebit += line.debit || 0;
            accCredit += line.credit || 0;
          }

          lastEvaluatedKey = queryResult.LastEvaluatedKey;
        } while (lastEvaluatedKey);

        if (accDebit > 0 || accCredit > 0) {
          aggregates[accountId] = { debit: accDebit, credit: accCredit };
        }
      })
    );

    // 4. Build the final Trial Balance report
    const trialBalance: TrialBalanceItem[] = allAccounts
      .map((account) => {
        const agg = aggregates[account.accountId] || { debit: 0, credit: 0 };
        const rawBalance = agg.debit - agg.credit;

        return {
          accountId: account.accountId,
          accountName: account.accountName,
          accountNature: account.accountNature,
          totalDebit: agg.debit,
          totalCredit: agg.credit,
          // In OHADA accounting, we show separate Debit or Credit balance columns
          debitBalance: rawBalance > 0 ? rawBalance : 0,
          creditBalance: rawBalance < 0 ? Math.abs(rawBalance) : 0,
        };
      })
      .sort((a, b) => a.accountId.localeCompare(b.accountId));

    return toLambdaResponse(
      ok(trialBalance, i18n.getMessage("SUCCESS_TRIAL_BALANCE_RETRIEVED"))
    );
  } catch (error) {
    console.error("Error in get-trial-balance:", error);
    return toLambdaResponse(badRequest(i18n.getMessage("ERROR_INTERNAL")));
  }
};
