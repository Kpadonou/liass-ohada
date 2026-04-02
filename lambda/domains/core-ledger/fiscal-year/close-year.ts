import { config } from "@/lambda/shared/config";
import { dynamoClient } from "@/lambda/shared/dynamo-client";
import { I18nResolver } from "@/lambda/shared/i18n";
import { KeyFactory } from "@/lambda/shared/key-builder";
import {
  badRequest,
  created,
  notFound,
  toLambdaResponse,
} from "@/models/shared/api-response";
import {
  GetItemCommand,
  QueryCommand,
  TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";

/**
 * Performs the year-end closing procedure.
 * 1. Validates that the fiscal year is OPEN.
 * 2. Aggregates balances for all Income Statement accounts (OHADA Classes 6 & 7).
 * 3. Calculates the net result and creates a closing entry (Type: YEC).
 * 4. Offsets classes 6 & 7 to the Result account (131 for profit, 139 for loss).
 * 5. Atomically switches the Fiscal Year status to CLOSED.
 */
export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  const i18n = new I18nResolver(event.headers["Accept-Language"]);

  try {
    const orgId = event.requestContext.authorizer?.claims?.orgId;
    const userId = event.requestContext.authorizer?.claims?.userId;
    const year = parseInt(
      event.queryStringParameters?.year || new Date().getFullYear().toString(),
    );

    // 1. Fiscal Year Validation via KeyFactory
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

    const fiscalYear = unmarshall(fyResult.Item);
    if (fiscalYear.status !== "OPEN") {
      return toLambdaResponse(
        badRequest(i18n.getMessage("ERROR_FISCAL_YEAR_LOCKED")),
      );
    }

    // 2. Movement Retrieval via Optimized GSI
    // We fetch all account movements to aggregate balances
    let rawMovements: any[] = [];
    let lastKey: any = undefined;
    do {
      const output = await dynamoClient.send(
        new QueryCommand({
          TableName: config.TABLE_NAME,
          IndexName: config.GSI1,
          KeyConditionExpression: "GSI1PK = :pk AND begins_with(GSI1SK, :sk)",
          ExpressionAttributeValues: marshall({
            ":pk": KeyFactory.gsi1PK(orgId),
            ":sk": `ACC#`,
          }),
          ExclusiveStartKey: lastKey,
        }),
      );
      if (output.Items)
        rawMovements.push(...output.Items.map((i) => unmarshall(i)));
      lastKey = output.LastEvaluatedKey;
    } while (lastKey);

    // Strict filtering on current year and Management Accounts (Classes 6 & 7)
    const movementsToClose = rawMovements.filter(
      (l) =>
        Number(l.year) === year &&
        (l.accountId.startsWith("6") || l.accountId.startsWith("7")),
    );

    // 3. Balance Aggregation
    const accountBalances: Record<string, number> = {};
    movementsToClose.forEach((m) => {
      accountBalances[m.accountId] =
        (accountBalances[m.accountId] || 0) +
        (Number(m.debit) || 0) -
        (Number(m.credit) || 0);
    });

    // 4. Closing Lines Preparation
    const closingLines: any[] = [];
    let netResult = 0;

    for (const [accountId, balance] of Object.entries(accountBalances)) {
      if (balance === 0) continue;
      closingLines.push({
        accountId,
        debit: balance < 0 ? Math.abs(balance) : 0, // If credit balance, debit it to zero out
        credit: balance > 0 ? balance : 0, // If debit balance, credit it to zero out
      });
      netResult += balance;
    }

    if (closingLines.length === 0) {
      return toLambdaResponse(
        badRequest(i18n.getMessage("ERROR_NO_MOVEMENTS_FOUND")),
      );
    }

    // Determine OHADA Result Account (131: Profit / 139: Loss)
    const isProfit = netResult < 0; // In OHADA, a negative sum of balances (6-7) means Credit > Debit = Profit
    const resultAccountId = isProfit ? "13100000" : "13900000";

    closingLines.push({
      accountId: resultAccountId,
      debit: isProfit ? Math.abs(netResult) : 0,
      credit: isProfit ? 0 : Math.abs(netResult),
    });

    const totalEntryDebit = closingLines.reduce((sum, l) => sum + l.debit, 0);

    // 5. Execute Atomic Closing Transaction
    const entryId = `YEC-${year}`;
    const entryDate = `${year}-12-31`;
    const transactItems: any[] = [];

    // Closing Entry Header
    transactItems.push({
      Put: {
        TableName: config.TABLE_NAME,
        Item: marshall({
          PK: KeyFactory.partitionKey(orgId, year),
          SK: KeyFactory.entrySK(entryId),
          entityType: "ENTRY",
          entryId,
          entryDate,
          year,
          journalCode: "OD",
          description: `Year-end closing ${year}`,
          status: "POSTED",
          totalDebit: totalEntryDebit,
          totalCredit: totalEntryDebit,
          createdBy: userId,
          createdAt: new Date().toISOString(),
        }),
      },
    });

    // Closing Entry Lines
    closingLines.forEach((l, idx) => {
      const lineId = `${entryId}-L${idx}`;
      transactItems.push({
        Put: {
          TableName: config.TABLE_NAME,
          Item: marshall({
            PK: KeyFactory.partitionKey(orgId, year),
            SK: KeyFactory.entryLineSK(lineId),
            GSI1PK: KeyFactory.gsi1PK(orgId),
            GSI1SK: KeyFactory.gsi1SK(l.accountId, year, entryDate, lineId),
            entityType: "ENTRY_LINE",
            accountId: l.accountId,
            debit: l.debit,
            credit: l.credit,
            year,
            entryDate,
            entryId,
            orgId,
          }),
        },
      });
    });

    // Final Fiscal Year Lock
    transactItems.push({
      Update: {
        TableName: config.TABLE_NAME,
        Key: marshall({
          PK: KeyFactory.orgKey(orgId),
          SK: KeyFactory.fiscalYearSK(year),
        }),
        UpdateExpression: "SET #st = :s, updatedAt = :now",
        ExpressionAttributeNames: { "#st": "status" },
        ExpressionAttributeValues: marshall({
          ":s": "CLOSED",
          ":now": new Date().toISOString(),
        }),
      },
    });

    await dynamoClient.send(
      new TransactWriteItemsCommand({ TransactItems: transactItems }),
    );

    return toLambdaResponse(
      created(
        {
          entryId,
          netResult: Math.abs(netResult),
          totalDebit: totalEntryDebit,
          isProfit,
        },
        i18n.getMessage("SUCCESS_YEAR_END_CLOSED"),
      ),
    );
  } catch (error) {
    console.error("Closing Error:", error);
    return toLambdaResponse(badRequest(i18n.getMessage("ERROR_INTERNAL")));
  }
};
