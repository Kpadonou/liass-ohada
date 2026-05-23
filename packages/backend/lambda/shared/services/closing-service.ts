import { config } from "@/lambda/shared/config";
import { dynamoClient } from "@/lambda/shared/dynamo-client";
import { KeyFactory } from "@/lambda/shared/key-builder";
import { TransactWriteItemsCommand } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";

export class ClosingService {
  static async executeYearEnd(
    orgId: string,
    params: { year: string; userId: string; balances: any[] },
  ) {
    const { year, userId, balances } = params;
    const entryId = `YEC-${year}`;
    const entryDate = `${year}-12-31`;
    const now = new Date().toISOString();
    let netResult = 0;

    // Prepare lines to zero out accounts
    const transactionLines = balances
      .map((b, idx) => {
        const balance =
          b.openingDebit +
          b.movementDebit -
          (b.openingCredit + b.movementCredit);
        netResult += balance;

        return {
          accountId: b.accountId,
          debit: balance < 0 ? Math.abs(balance) : 0, // If Credit balance, Debit it
          credit: balance > 0 ? balance : 0, // If Debit balance, Credit it
        };
      })
      .filter((l) => l.debit !== 0 || l.credit !== 0);

    // OHADA Result: Account 131 (Profit) or 139 (Loss)
    const isProfit = netResult < 0; // Credit > Debit in Classes 6/7
    const resultAccount = isProfit ? "13100000" : "13900000";

    transactionLines.push({
      accountId: resultAccount,
      debit: isProfit ? Math.abs(netResult) : 0,
      credit: isProfit ? 0 : Math.abs(netResult),
    });

    const totalAmount = transactionLines.reduce((sum, l) => sum + l.debit, 0);

    const transactItems: any[] = [
      // 1. Entry Header (With GSI5 for Journal)
      {
        Put: {
          TableName: config.TABLE_NAME,
          Item: marshall({
            PK: KeyFactory.partitionKey(orgId, year),
            SK: KeyFactory.entrySK(entryId),
            entityType: "ENTRY",
            journalCode: "OD",
            GSI5PK: KeyFactory.gsi5JournalPK(orgId, year),
            GSI5SK: KeyFactory.gsi5JournalSK("OD", entryDate, entryId),
            totalDebit: totalAmount,
            totalCredit: totalAmount,
            status: "POSTED",
            description: `Clôture annuelle ${year}`,
            createdBy: userId,
            createdAt: now,
            updatedAt: now,
          }),
          ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
        },
      },
      // 2. Lock Fiscal Year
      {
        Update: {
          TableName: config.TABLE_NAME,
          Key: marshall({
            PK: KeyFactory.orgKey(orgId),
            SK: KeyFactory.fiscalYearSK(year),
          }),
          ConditionExpression: "#s = :open",
          UpdateExpression:
            "SET #s = :c, closedAt = :now, updatedAt = :now, updatedBy = :userId",
          ExpressionAttributeNames: { "#s": "status" },
          ExpressionAttributeValues: marshall({
            ":open": "OPEN",
            ":c": "CLOSED",
            ":now": now,
            ":userId": userId,
          }),
        },
      },
    ];

    // 3. Add Entry Lines (With GSI1 for General Ledger)
    transactionLines.forEach((l, idx) => {
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
            ...l,
            entryId,
            entryDate,
            createdBy: userId,
            createdAt: now,
            updatedAt: now,
          }),
          ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
        },
      });
    });

    await dynamoClient.send(
      new TransactWriteItemsCommand({ TransactItems: transactItems }),
    );

    return { entryId, netResult: Math.abs(netResult), isProfit };
  }
}
