import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import {
  TransactWriteItemsCommand,
  GetItemCommand,
  QueryCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { KeyFactory } from "../../../shared/key-builder";
import { I18nResolver } from "../../../shared/i18n";
import {
  badRequest,
  created,
  toLambdaResponse,
  notFound,
} from "../../../../models/shared/api-response";
import { dynamoClient } from "../../../shared/dynamo-client";
import { config } from "../../../shared/config";

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const i18n = new I18nResolver(event.headers["Accept-Language"]);
  let response: APIGatewayProxyResult;

  try {
    const orgId =
      event.requestContext.authorizer?.claims?.orgId || "test-org-001";
    const userId =
      event.requestContext.authorizer?.claims?.userId || "user-123";
    const year = parseInt(
      event.queryStringParameters?.year || new Date().getFullYear().toString()
    );

    // 1. Validate Fiscal Year (Zod validation happens here via model)
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
    const fiscalYear = unmarshall(fyResult.Item);
    if (fiscalYear.status !== "OPEN")
      return toLambdaResponse(
        badRequest(i18n.getMessage("ERROR_FISCAL_YEAR_LOCKED"))
      );

    // 2. Fetch ALL movements for the organization
    let rawMovements: any[] = [];
    let lastKey: any = undefined;
    do {
      const output = await dynamoClient.send(
        new QueryCommand({
          TableName: config.TABLE_NAME,
          IndexName: "GSI_ACCOUNT",
          KeyConditionExpression: "GSI1PK = :pk AND begins_with(GSI1SK, :sk)",
          ExpressionAttributeValues: {
            ":pk": { S: KeyFactory.gsiAccountPK(orgId) },
            ":sk": { S: `ACC#` },
          },
          ExclusiveStartKey: lastKey,
        })
      );
      if (output.Items)
        rawMovements.push(...output.Items.map((i) => unmarshall(i)));
      lastKey = output.LastEvaluatedKey;
    } while (lastKey);
    console.log(`Raw items found in GSI: ${rawMovements.length}`);

    // Filter by year and Classes 6 & 7
    const movementsToClose = rawMovements.filter(
      (l) =>
        Number(l.year) === year &&
        (l.accountId.startsWith("6") || l.accountId.startsWith("7"))
    );

    // 3. Aggregate balances per account (Section 3)
    const accountBalances: Record<string, number> = {};
    movementsToClose.forEach((m) => {
      accountBalances[m.accountId] =
        (accountBalances[m.accountId] || 0) +
        (Number(m.debit) || 0) -
        (Number(m.credit) || 0);
    });

    // 4. Prepare Closing Lines (Section 4)
    const closingLines: any[] = [];
    let netResult = 0; // Cumulative (Debit - Credit)

    for (const [accountId, balance] of Object.entries(accountBalances)) {
      if (balance === 0) continue;
      // To zero out: if balance is positive (Debit), we Credit it.
      closingLines.push({
        accountId,
        debit: balance < 0 ? Math.abs(balance) : 0,
        credit: balance > 0 ? balance : 0,
      });
      netResult += balance;
    }

    if (closingLines.length === 0) {
      return toLambdaResponse(
        badRequest(i18n.getMessage("ERROR_NO_MOVEMENTS_FOUND"))
      );
    }

    // Result account (OHADA: 131 for Profit, 139 for Loss)
    const isProfit = netResult < 0; // Negative netResult means Credits > Debits
    const resultAccountId = isProfit ? "13100000" : "13900000";

    closingLines.push({
      accountId: resultAccountId,
      debit: isProfit ? Math.abs(netResult) : 0,
      credit: isProfit ? 0 : netResult,
    });

    const totalEntryDebit = closingLines.reduce((sum, l) => sum + l.debit, 0);

    // 5. Build and Execute Transaction
    const entryId = `YEC-${year}`;
    const entryDate = `${year}-12-31`;
    const transactItems: any[] = [];

    // Entry Header
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

    // Entry Lines
    closingLines.forEach((l, idx) => {
      const lineId = `L-${entryId}-${idx}`;
      transactItems.push({
        Put: {
          TableName: config.TABLE_NAME,
          Item: marshall({
            PK: KeyFactory.partitionKey(orgId, year),
            SK: KeyFactory.entryLineSK(lineId),
            GSI1PK: KeyFactory.gsiAccountPK(orgId),
            GSI1SK: KeyFactory.gsiAccountSK(
              l.accountId,
              year,
              entryDate,
              lineId
            ),
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

    // Lock Fiscal Year
    transactItems.push({
      Update: {
        TableName: config.TABLE_NAME,
        Key: { PK: { S: KeyFactory.orgKey(orgId) }, SK: { S: `FY#${year}` } },
        UpdateExpression: "SET #st = :s, updatedAt = :now",
        ExpressionAttributeNames: { "#st": "status" },
        ExpressionAttributeValues: {
          ":s": { S: "CLOSED" },
          ":now": { S: new Date().toISOString() },
        },
      },
    });

    await dynamoClient.send(
      new TransactWriteItemsCommand({ TransactItems: transactItems })
    );

    response = toLambdaResponse(
      created(
        {
          entryId,
          netResult: Math.abs(netResult),
          totalDebit: totalEntryDebit,
          isProfit,
        },
        i18n.getMessage("SUCCESS_YEAR_END_CLOSED")
      )
    );
  } catch (error) {
    console.error("Closing Error:", error);
    response = toLambdaResponse(badRequest(i18n.getMessage("ERROR_INTERNAL")));
  }

  return response;
};
