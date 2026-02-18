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

// SYSCOHADA Standard: RAN (Report à Nouveau) for opening balances
const OPENING_JOURNAL_CODE = "RAN";

interface TrialBalanceItem {
  accountId: string;
  accountName: string;
  accountNature: string;
  // 1. Opening Balances (from RAN journal)
  openingDebit: number;
  openingCredit: number;
  // 2. Period Movements (all journals except RAN)
  movementDebit: number;
  movementCredit: number;
  // 3. Final Balances (Net total)
  finalDebitBalance: number;
  finalCreditBalance: number;
}

/**
 * Generates a 6-column Trial Balance report.
 * It aggregates all entry lines for the specified fiscal year,
 * distinguishing between 'Opening Balances' (RAN journal) and 'Period Movements'.
 * The final net balance is calculated for each account to ensure ledger equilibrium.
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

    if (!orgId)
      return toLambdaResponse(
        badRequest(i18n.getMessage("ERROR_MISSING_ORG_ID")),
      );

    // 1. Fiscal Year Validation
    const fyResult = await dynamoClient.send(
      new GetItemCommand({
        TableName: config.TABLE_NAME,
        Key: marshall({
          PK: KeyFactory.orgKey(orgId),
          SK: KeyFactory.fiscalYearSK(year),
        }),
      }),
    );

    if (!fyResult.Item)
      return toLambdaResponse(
        notFound(i18n.getMessage("ERROR_FISCAL_YEAR_NOT_FOUND")),
      );

    // 2. Fetch the Organization's Chart of Accounts
    const accountsQuery = await dynamoClient.send(
      new QueryCommand({
        TableName: config.TABLE_NAME,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
        ExpressionAttributeValues: marshall({
          ":pk": KeyFactory.orgKey(orgId),
          ":sk": "ACC#",
        }),
      }),
    );

    const allAccounts =
      accountsQuery.Items?.map((item) => unmarshall(item)) || [];

    // 3. Parallelized Aggregation
    // We iterate through accounts to compute sums from the GSI_ACCOUNT index
    const aggregates: Record<
      string,
      { opD: number; opC: number; mvD: number; mvC: number }
    > = {};

    await Promise.all(
      allAccounts.map(async (account) => {
        const accountId = account.accountId;
        let lastEvaluatedKey: any = undefined;
        let opD = 0,
          opC = 0,
          mvD = 0,
          mvC = 0;

        do {
          const queryResult = await dynamoClient.send(
            new QueryCommand({
              TableName: config.TABLE_NAME,
              IndexName: config.GSI_ACCOUNT,
              KeyConditionExpression:
                "GSI1PK = :pk AND begins_with(GSI1SK, :gsi1sk)",
              ExpressionAttributeValues: marshall({
                ":pk": KeyFactory.gsi1PK(orgId),
                ":gsi1sk": `ACC#${accountId}#FY#${year}#`,
              }),
              ExclusiveStartKey: lastEvaluatedKey,
            }),
          );

          for (const item of queryResult.Items || []) {
            const line = unmarshall(item);
            const d = Number(line.debit) || 0;
            const c = Number(line.credit) || 0;

            // Accounting Logic: Separate RAN (Opening) from regular movements
            if (line.journalCode === OPENING_JOURNAL_CODE) {
              opD += d;
              opC += c;
            } else {
              mvD += d;
              mvC += c;
            }
          }
          lastEvaluatedKey = queryResult.LastEvaluatedKey;
        } while (lastEvaluatedKey);

        // Only keep accounts that have a history or balance
        if (opD || opC || mvD || mvC) {
          aggregates[accountId] = { opD, opC, mvD, mvC };
        }
      }),
    );

    // 4. Building the 6-column Balance View
    const trialBalance: TrialBalanceItem[] = allAccounts
      .map((account) => {
        const agg = aggregates[account.accountId] || {
          opD: 0,
          opC: 0,
          mvD: 0,
          mvC: 0,
        };

        // Total cumulative calculation for final net balance
        const totalD = agg.opD + agg.mvD;
        const totalC = agg.opC + agg.mvC;
        const rawFinal = totalD - totalC;

        return {
          accountId: account.accountId,
          accountName: account.accountName,
          accountNature: account.accountNature,
          openingDebit: agg.opD,
          openingCredit: agg.opC,
          movementDebit: agg.mvD,
          movementCredit: agg.mvC,
          finalDebitBalance: rawFinal > 0 ? rawFinal : 0,
          finalCreditBalance: rawFinal < 0 ? Math.abs(rawFinal) : 0,
        };
      })
      .filter(
        (item) =>
          item.openingDebit +
            item.openingCredit +
            item.movementDebit +
            item.movementCredit >
          0,
      )
      .sort((a, b) => a.accountId.localeCompare(b.accountId));

    return toLambdaResponse(
      ok(trialBalance, i18n.getMessage("SUCCESS_TRIAL_BALANCE_RETRIEVED")),
    );
  } catch (error) {
    console.error("Error Trial Balance:", error);
    return toLambdaResponse(badRequest(i18n.getMessage("ERROR_INTERNAL")));
  }
};
