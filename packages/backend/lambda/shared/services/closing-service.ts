import { config } from "@/lambda/shared/config";
import { dynamoClient } from "@/lambda/shared/dynamo-client";
import { KeyFactory } from "@/lambda/shared/key-builder";
import { AppError } from "@/lambda/shared/middleware/handler-wrapper";
import { TransactWriteItemsCommand } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { EntryLineSchema, EntrySchema } from "@liass-ohada/shared/accounting";
import { BalanceService } from "./balance-service";

export class ClosingService {
  static async executeYearEnd(
    orgId: string,
    params: { year: string; userId: string; balances: any[] },
  ) {
    const { year, userId, balances } = params;
    const entryId = `YEC-${year}`;
    const entryDate = `${year}-12-31`;
    const journalCode = "CLOSING";
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
      debit: isProfit ? 0 : Math.abs(netResult),
      credit: isProfit ? Math.abs(netResult) : 0,
    });

    const totalAmount = transactionLines.reduce((sum, l) => sum + l.debit, 0);
    const totalWriteCount = 2 + transactionLines.length * 2;
    if (totalWriteCount > 100) {
      throw new AppError(400, "ERROR_YEAR_END_TOO_LARGE");
    }

    const transactItems: any[] = [
      {
        Put: {
          TableName: config.TABLE_NAME,
          Item: marshall(
            EntrySchema.parse({
              orgId,
              year: Number(year),
              entryId,
              entryType: "CLOSING",
              entryDate,
              journalCode,
              totalDebit: totalAmount,
              totalCredit: totalAmount,
              status: "POSTED",
              label: `Cloture annuelle ${year}`,
              PK: KeyFactory.partitionKey(orgId, year),
              SK: KeyFactory.entrySK(entryId),
              GSI5PK: KeyFactory.gsi5JournalPK(orgId, year),
              GSI5SK: KeyFactory.gsi5JournalSK(journalCode, entryDate, entryId),
              entityType: "ENTRY",
              createdBy: userId,
              createdAt: now,
              updatedBy: userId,
              updatedAt: now,
            }),
            { removeUndefinedValues: true },
          ),
          ConditionExpression:
            "attribute_not_exists(PK) AND attribute_not_exists(SK)",
        },
      },
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

    transactionLines.forEach((l, idx) => {
      const lineId = `${entryId}-L${idx}`;
      transactItems.push({
        Put: {
          TableName: config.TABLE_NAME,
          Item: marshall(
            EntryLineSchema.parse({
              orgId,
              year: Number(year),
              lineId,
              entryId,
              entryDate,
              journalCode,
              accountId: l.accountId,
              debit: l.debit,
              credit: l.credit,
              label: `Cloture annuelle ${year}`,
              entityType: "ENTRY_LINE",
              PK: KeyFactory.partitionKey(orgId, year),
              SK: KeyFactory.entryLineSK(lineId),
              GSI1PK: KeyFactory.gsi1PK(orgId),
              GSI1SK: KeyFactory.gsi1SK(l.accountId, year, entryDate, lineId),
              createdBy: userId,
              createdAt: now,
              updatedBy: userId,
              updatedAt: now,
            }),
            { removeUndefinedValues: true },
          ),
          ConditionExpression:
            "attribute_not_exists(PK) AND attribute_not_exists(SK)",
        },
      });
      transactItems.push(
        BalanceService.buildBalanceUpdateAction(
          orgId,
          year,
          l.accountId,
          l.debit,
          l.credit,
          journalCode,
          userId,
        ),
      );
    });

    try {
      await dynamoClient.send(
        new TransactWriteItemsCommand({ TransactItems: transactItems }),
      );
    } catch (error: any) {
      if (error?.name === "TransactionCanceledException") {
        throw new AppError(409, "ERROR_FISCAL_YEAR_CLOSE_CONFLICT");
      }
      throw error;
    }

    return { entryId, netResult: Math.abs(netResult), isProfit };
  }
}
