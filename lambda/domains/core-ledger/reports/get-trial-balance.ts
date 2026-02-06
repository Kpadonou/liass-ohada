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

// Constante pour identifier le journal d'ouverture
const OPENING_JOURNAL_CODE = "RAN";

interface TrialBalanceItem {
  accountId: string;
  accountName: string;
  accountNature: string;
  // 1. Soldes Initiaux (Opening)
  openingDebit: number;
  openingCredit: number;
  // 2. Mouvements de la période
  movementDebit: number;
  movementCredit: number;
  // 3. Soldes Finaux (Closing)
  finalDebitBalance: number;
  finalCreditBalance: number;
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

    // 1. Validation de l'exercice
    const fyResult = await dynamoClient.send(
      new GetItemCommand({
        TableName: config.TABLE_NAME,
        Key: { PK: { S: KeyFactory.orgKey(orgId) }, SK: { S: `FY#${year}` } },
      })
    );

    if (!fyResult.Item)
      return toLambdaResponse(
        notFound(i18n.getMessage("ERROR_FISCAL_YEAR_NOT_FOUND"))
      );

    // 2. Récupération du plan comptable de l'organisation
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

    // 3. Agrégation par compte (Parallélisée)
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
              IndexName: "GSI-Account",
              KeyConditionExpression:
                "GSI1PK = :pk AND begins_with(GSI1SK, :gsi1sk)",
              ExpressionAttributeValues: {
                ":pk": { S: KeyFactory.gsiAccountPK(orgId) },
                ":gsi1sk": { S: `ACC#${accountId}#FY#${year}#` },
              },
              ExclusiveStartKey: lastEvaluatedKey,
            })
          );

          for (const item of queryResult.Items || []) {
            const line = unmarshall(item);
            const d = line.debit || 0;
            const c = line.credit || 0;

            // Separation logic: Opening vs Movement
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

        if (opD || opC || mvD || mvC) {
          aggregates[accountId] = { opD, opC, mvD, mvC };
        }
      })
    );

    // 4. Construction de la balance à 6 colonnes
    const trialBalance: TrialBalanceItem[] = allAccounts
      .map((account) => {
        const agg = aggregates[account.accountId] || {
          opD: 0,
          opC: 0,
          mvD: 0,
          mvC: 0,
        };

        // Total cumulé pour le calcul du solde final
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
      .sort((a, b) => a.accountId.localeCompare(b.accountId));

    return toLambdaResponse(
      ok(trialBalance, i18n.getMessage("SUCCESS_TRIAL_BALANCE_RETRIEVED"))
    );
  } catch (error) {
    console.error("Error Trial Balance:", error);
    return toLambdaResponse(badRequest(i18n.getMessage("ERROR_INTERNAL")));
  }
};
