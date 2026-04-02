import { config } from "@/lambda/shared/config";
import { dynamoClient } from "@/lambda/shared/dynamo-client";
import { KeyFactory } from "@/lambda/shared/key-builder";
import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { BalanceService } from "@/lambda/shared/services/balance-service";
import { QueryCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { z } from "zod";

interface LedgerEntry {
  date: string;
  label: string;
  reference: string;
  journal: string;
  debit: number;
  credit: number;
  runningBalance: number;
}

interface GeneralLedgerResponse {
  accountId: string;
  openingBalance: LedgerEntry;
  movements: LedgerEntry[];
  finalBalance: number;
}

/**
 * @description Slim handler for General Ledger by account.
 * - Retrieves the account's pre-calculated opening balance (RAN).
 * - Fetches all movements from the fiscal year using GSI_ACCOUNT.
 * - Computes running balance starting from opening balance.
 * - Returns chronologically-sorted entries with metadata.
 */
const GeneralLedgerRequestSchema = z.object({
  fiscalYear: z
    .string()
    .regex(/^\d{4}$/, "Fiscal year must be a 4-digit string"),
  accountId: z
    .string()
    .regex(/^\d{2,8}$/, "Account ID must be numeric with 2-8 digits"),
});

export const handler = createHandler(
  GeneralLedgerRequestSchema,
  async (data, { orgId, i18n }) => {
    const paddedAccountId = data.accountId.padEnd(8, "0");

    // 1. Retrieve opening balance (RAN opening balance)
    const accountBalance = await BalanceService.getAccountBalance(
      orgId,
      data.fiscalYear,
      paddedAccountId,
    );

    // Compute opening balance net
    const openingNet =
      accountBalance.openingDebit - accountBalance.openingCredit;

    // 2. Query GSI_ACCOUNT for all transactions in chronological order
    const queryResult = await dynamoClient.send(
      new QueryCommand({
        TableName: config.TABLE_NAME,
        IndexName: config.GSI_ACCOUNT,
        KeyConditionExpression:
          "GSI1PK = :gsi1pk AND begins_with(GSI1SK, :gsi1sk)",
        ExpressionAttributeValues: marshall({
          ":gsi1pk": KeyFactory.gsi1PK(orgId),
          ":gsi1sk": KeyFactory.gsi1SKPrefix(paddedAccountId, data.fiscalYear),
        }),
        ScanIndexForward: true,
      }),
    );

    // 3. Build ledger entries with running balance
    let runningBalance = openingNet;
    const movements: LedgerEntry[] = [];

    if (queryResult.Items) {
      for (const item of queryResult.Items) {
        const line = unmarshall(item);
        if (line.journalCode === "RAN") continue; // Éviter de recompter les lignes de report à nouveau si déjà incluses dans openingNet
        const debit = Number(line.debit) || 0;
        const credit = Number(line.credit) || 0;

        runningBalance += debit - credit;

        movements.push({
          date: line.entryDate,
          label: line.label || line.description || "-",
          reference: line.entryId || "N/A",
          journal: line.journalCode,
          debit,
          credit,
          runningBalance,
        });
      }
    }

    // 4. Construct opening balance row
    const openingBalance: LedgerEntry = {
      date: "OPENING",
      label: "Opening Balance (Report à Nouveau)",
      reference: "RAN",
      journal: "RAN",
      debit: accountBalance.openingDebit,
      credit: accountBalance.openingCredit,
      runningBalance: openingNet,
    };

    return {
      message: i18n.getMessage("SUCCESS_LEDGER_RETRIEVED"),
      data: {
        accountId: paddedAccountId,
        openingBalance,
        movements,
        finalBalance: runningBalance,
      } as GeneralLedgerResponse,
    };
  },
);
