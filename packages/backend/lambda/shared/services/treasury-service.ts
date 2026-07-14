import { config } from "@/lambda/shared/config";
import { dynamoClient } from "@/lambda/shared/dynamo-client";
import { KeyFactory } from "@/lambda/shared/key-builder";
import { AppError } from "@/lambda/shared/middleware/handler-wrapper";
import { AccountSchema } from "@liass-ohada/shared/accounting";
import {
  BankStatementLineDto,
  BankStatementLineDtoSchema,
  BankStatementLineSchema,
  CreateReconciliationRequest,
  CreateTreasuryAccountRequest,
  CreateTreasuryTransactionRequest,
  ImportBankStatementLine,
  ListTreasuryAccountsRequest,
  ReconciliationMatchDto,
  ReconciliationMatchDtoSchema,
  ReconciliationMatchSchema,
  TreasuryAccountDto,
  TreasuryAccountDtoSchema,
  TreasuryAccountSchema,
  TreasuryMovementDto,
  TreasuryMovementDtoSchema,
  TreasurySummaryDto,
} from "@liass-ohada/shared/treasury";
import {
  GetItemCommand,
  PutItemCommand,
  QueryCommand,
  TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { createHash, randomUUID } from "crypto";
import { BalanceService } from "./balance-service";
import { LedgerService } from "./ledger-service";

export class TreasuryService {
  static async createAccount(
    orgId: string,
    userId: string,
    input: CreateTreasuryAccountRequest,
  ): Promise<TreasuryAccountDto> {
    const accountId = input.accountId.padEnd(8, "0");
    await TreasuryService.assertTreasuryLedgerAccount(orgId, accountId);

    const now = new Date().toISOString();
    const treasuryAccountId = accountId;
    const item = {
      PK: KeyFactory.orgKey(orgId),
      SK: KeyFactory.treasuryAccountSK(treasuryAccountId),
      ...TreasuryAccountSchema.parse({
        ...input,
        orgId,
        accountId,
        treasuryAccountId,
        currency: input.currency.toUpperCase(),
        active: true,
        entityType: "TREASURY_ACCOUNT",
        createdAt: now,
        updatedAt: now,
      }),
      createdBy: userId,
      updatedBy: userId,
    };

    try {
      await dynamoClient.send(
        new PutItemCommand({
          TableName: config.TABLE_NAME,
          Item: marshall(item, { removeUndefinedValues: true }),
          ConditionExpression:
            "attribute_not_exists(PK) AND attribute_not_exists(SK)",
        }),
      );
    } catch (error: any) {
      if (error?.name === "ConditionalCheckFailedException") {
        throw new AppError(400, "ERROR_TREASURY_ACCOUNT_ALREADY_EXISTS");
      }
      throw error;
    }

    return TreasuryAccountDtoSchema.parse(item);
  }

  static async listAccounts(
    orgId: string,
    options: ListTreasuryAccountsRequest = {},
  ): Promise<{
    accounts: TreasuryAccountDto[];
    nextCursor?: string;
    hasMore: boolean;
    count: number;
  }> {
    const exclusiveStartKey = TreasuryService.decodeTreasuryAccountCursor(
      orgId,
      options.cursor,
    );
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: config.TABLE_NAME,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
        ExpressionAttributeValues: marshall({
          ":pk": KeyFactory.orgKey(orgId),
          ":sk": KeyFactory.treasuryAccountPrefix(),
        }),
        ExclusiveStartKey: exclusiveStartKey,
        Limit: options.limit ?? 100,
      }),
    );

    const accounts = (result.Items || [])
      .map((item) => unmarshall(item))
      .filter((item) => item.entityType === "TREASURY_ACCOUNT")
      .map((item) => TreasuryAccountDtoSchema.parse(item));

    const nextCursor = TreasuryService.encodeCursor(result.LastEvaluatedKey);

    return {
      accounts,
      nextCursor,
      hasMore: !!nextCursor,
      count: accounts.length,
    };
  }

  static async getAccount(
    orgId: string,
    treasuryAccountId: string,
  ): Promise<TreasuryAccountDto> {
    const result = await dynamoClient.send(
      new GetItemCommand({
        TableName: config.TABLE_NAME,
        Key: marshall({
          PK: KeyFactory.orgKey(orgId),
          SK: KeyFactory.treasuryAccountSK(treasuryAccountId),
        }),
      }),
    );

    if (!result.Item) {
      throw new AppError(404, "ERROR_TREASURY_ACCOUNT_NOT_FOUND");
    }

    return TreasuryAccountDtoSchema.parse(unmarshall(result.Item));
  }

  static async listMovements(
    orgId: string,
    treasuryAccountId: string,
    year: string,
  ): Promise<TreasuryMovementDto[]> {
    const account = await TreasuryService.getAccount(orgId, treasuryAccountId);
    const balance = await BalanceService.getAccountBalance(
      orgId,
      year,
      account.accountId,
    );
    let runningBalance = balance.openingDebit - balance.openingCredit;

    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: config.TABLE_NAME,
        IndexName: config.GSI1,
        KeyConditionExpression: "GSI1PK = :pk AND begins_with(GSI1SK, :sk)",
        ExpressionAttributeValues: marshall({
          ":pk": KeyFactory.gsi1PK(orgId),
          ":sk": KeyFactory.gsi1SKPrefix(account.accountId, year),
        }),
        ScanIndexForward: true,
      }),
    );

    const movements: TreasuryMovementDto[] = [];
    for (const item of result.Items || []) {
      const line = unmarshall(item);
      if (line.journalCode === "RAN") continue;

      const debit = Number(line.debit) || 0;
      const credit = Number(line.credit) || 0;
      runningBalance += debit - credit;

      movements.push(
        TreasuryMovementDtoSchema.parse({
          treasuryAccountId,
          accountId: account.accountId,
          entryId: line.entryId,
          lineId: line.lineId,
          date: line.entryDate,
          journalCode: line.journalCode,
          label: line.label || line.description || "-",
          reference: line.voucherNumber || line.entryId || "N/A",
          debit,
          credit,
          amount: debit > 0 ? debit : credit,
          direction: debit > 0 ? "INFLOW" : "OUTFLOW",
          runningBalance,
          statementLineId: line.statementLineId,
          reconciliationMatchId: line.reconciliationMatchId,
          reconciliationStatus:
            line.reconciliationStatus === "MATCHED" ? "MATCHED" : "UNMATCHED",
        }),
      );
    }

    return movements;
  }

  static async postTransaction(
    orgId: string,
    userId: string,
    input: CreateTreasuryTransactionRequest,
  ): Promise<{ entryId: string }> {
    const account = await TreasuryService.getAccount(
      orgId,
      input.treasuryAccountId,
    );

    if (!["BANK", "MISC"].includes(input.journalCode.toUpperCase())) {
      throw new AppError(400, "ERROR_TREASURY_JOURNAL_INVALID");
    }

    const treasuryLine =
      input.direction === "INFLOW"
        ? {
            accountId: account.accountId,
            debit: input.amount,
            credit: 0,
            label: input.label,
          }
        : {
            accountId: account.accountId,
            debit: 0,
            credit: input.amount,
            label: input.label,
          };
    const counterpartyLine =
      input.direction === "INFLOW"
        ? {
            accountId: input.counterpartyAccountId,
            debit: 0,
            credit: input.amount,
            label: input.label,
            thirdPartyId: input.thirdPartyId,
            projectId: input.projectId,
            budgetLineId: input.budgetLineId,
            donorId: input.donorId,
          }
        : {
            accountId: input.counterpartyAccountId,
            debit: input.amount,
            credit: 0,
            label: input.label,
            thirdPartyId: input.thirdPartyId,
            projectId: input.projectId,
            budgetLineId: input.budgetLineId,
            donorId: input.donorId,
          };

    const result = await LedgerService.postEntry({
      orgId,
      userId,
      data: {
        year: input.year,
        entryDate: input.entryDate,
        journalCode: input.journalCode.toUpperCase(),
        voucherNumber: input.voucherNumber,
        entryType: "STANDARD",
        label: input.label,
        currency: account.currency,
        lines: [treasuryLine, counterpartyLine],
      },
    });

    return { entryId: result.entryId };
  }

  static async listStatementLines(
    orgId: string,
    treasuryAccountId: string,
    year: string,
  ): Promise<BankStatementLineDto[]> {
    await TreasuryService.getAccount(orgId, treasuryAccountId);

    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: config.TABLE_NAME,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
        ExpressionAttributeValues: marshall({
          ":pk": KeyFactory.partitionKey(orgId, year),
          ":sk": KeyFactory.bankStatementLinePrefix(treasuryAccountId, year),
        }),
      }),
    );

    return (result.Items || []).map((item) =>
      BankStatementLineDtoSchema.parse(unmarshall(item)),
    );
  }

  static async importStatementLines(params: {
    orgId: string;
    treasuryAccountId: string;
    year: string;
    lines: ImportBankStatementLine[];
  }): Promise<{
    imported: number;
    skipped: number;
    errors: { index: number; message: string }[];
    statementLines: BankStatementLineDto[];
  }> {
    const { orgId, treasuryAccountId, year, lines } = params;
    const account = await TreasuryService.getAccount(orgId, treasuryAccountId);
    const importedLines: BankStatementLineDto[] = [];
    const errors: { index: number; message: string }[] = [];
    let imported = 0;
    let skipped = 0;

    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      try {
        const statementLineId = TreasuryService.buildStatementLineId(
          treasuryAccountId,
          line,
        );
        const importedAt = new Date().toISOString();
        const item = BankStatementLineSchema.parse({
          orgId,
          treasuryAccountId,
          statementLineId,
          year,
          date: line.date,
          reference: line.reference,
          label: line.label,
          amount: line.amount,
          currency: line.currency || account.currency,
          status: "UNMATCHED",
          importedAt,
          entityType: "BANK_STATEMENT_LINE",
        });

        await dynamoClient.send(
          new PutItemCommand({
            TableName: config.TABLE_NAME,
            Item: marshall(
              {
                PK: KeyFactory.partitionKey(orgId, year),
                SK: KeyFactory.bankStatementLineSK(
                  treasuryAccountId,
                  year,
                  line.date,
                  statementLineId,
                ),
                ...item,
              },
              { removeUndefinedValues: true },
            ),
            ConditionExpression:
              "attribute_not_exists(PK) AND attribute_not_exists(SK)",
          }),
        );

        imported++;
        importedLines.push(BankStatementLineDtoSchema.parse(item));
      } catch (error: any) {
        if (error?.name === "ConditionalCheckFailedException") {
          skipped++;
        } else {
          errors.push({
            index,
            message: error?.message || "Invalid statement line",
          });
        }
      }
    }

    return {
      imported,
      skipped,
      errors,
      statementLines: importedLines,
    };
  }

  static async reconcile(
    orgId: string,
    userId: string,
    input: CreateReconciliationRequest,
  ): Promise<ReconciliationMatchDto> {
    const account = await TreasuryService.getAccount(
      orgId,
      input.treasuryAccountId,
    );
    const statementLine = await TreasuryService.getStatementLine(
      orgId,
      input.treasuryAccountId,
      input.year,
      input.statementLineId,
    );
    const entryLine = await TreasuryService.getEntryLine(
      orgId,
      input.year,
      input.lineId,
    );

    if (entryLine.accountId !== account.accountId) {
      throw new AppError(400, "ERROR_RECONCILIATION_ACCOUNT_MISMATCH");
    }

    const movementAmount =
      Number(entryLine.debit || 0) > 0
        ? Number(entryLine.debit || 0)
        : Number(entryLine.credit || 0);
    if (Math.abs(statementLine.amount) !== movementAmount) {
      throw new AppError(400, "ERROR_RECONCILIATION_AMOUNT_MISMATCH");
    }

    const now = new Date().toISOString();
    const matchId = `RCN-${randomUUID()}`;
    const match = ReconciliationMatchSchema.parse({
      orgId,
      treasuryAccountId: input.treasuryAccountId,
      matchId,
      year: input.year,
      statementLineId: input.statementLineId,
      entryId: input.entryId,
      lineId: input.lineId,
      amount: statementLine.amount,
      status: "ACTIVE",
      matchedAt: now,
      entityType: "RECONCILIATION_MATCH",
    });

    await dynamoClient.send(
      new TransactWriteItemsCommand({
        TransactItems: [
          {
            Put: {
              TableName: config.TABLE_NAME,
              Item: marshall(
                {
                  PK: KeyFactory.partitionKey(orgId, input.year),
                  SK: KeyFactory.reconciliationMatchSK(
                    input.treasuryAccountId,
                    input.year,
                    matchId,
                  ),
                  ...match,
                  createdBy: userId,
                },
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
                PK: KeyFactory.partitionKey(orgId, input.year),
                SK: KeyFactory.bankStatementLineSK(
                  input.treasuryAccountId,
                  input.year,
                  statementLine.date,
                  input.statementLineId,
                ),
              }),
              UpdateExpression:
                "SET #status = :matched, matchedEntryId = :entryId, matchedLineId = :lineId, reconciliationMatchId = :matchId",
              ConditionExpression: "#status = :unmatched",
              ExpressionAttributeNames: {
                "#status": "status",
              },
              ExpressionAttributeValues: marshall({
                ":matched": "MATCHED",
                ":unmatched": "UNMATCHED",
                ":entryId": input.entryId,
                ":lineId": input.lineId,
                ":matchId": matchId,
              }),
            },
          },
          {
            Update: {
              TableName: config.TABLE_NAME,
              Key: marshall({
                PK: KeyFactory.partitionKey(orgId, input.year),
                SK: KeyFactory.entryLineSK(input.lineId),
              }),
              UpdateExpression:
                "SET reconciliationStatus = :matched, statementLineId = :statementLineId, reconciledAt = :now, reconciliationMatchId = :matchId",
              ConditionExpression: "attribute_exists(PK)",
              ExpressionAttributeValues: marshall({
                ":matched": "MATCHED",
                ":statementLineId": input.statementLineId,
                ":now": now,
                ":matchId": matchId,
              }),
            },
          },
        ],
      }),
    );

    return ReconciliationMatchDtoSchema.parse(match);
  }

  static async cancelReconciliation(
    orgId: string,
    treasuryAccountId: string,
    year: string,
    matchId: string,
  ): Promise<ReconciliationMatchDto> {
    const matchResult = await dynamoClient.send(
      new GetItemCommand({
        TableName: config.TABLE_NAME,
        Key: marshall({
          PK: KeyFactory.partitionKey(orgId, year),
          SK: KeyFactory.reconciliationMatchSK(treasuryAccountId, year, matchId),
        }),
      }),
    );

    if (!matchResult.Item) {
      throw new AppError(404, "ERROR_RECONCILIATION_NOT_FOUND");
    }

    const existing = ReconciliationMatchSchema.parse(
      unmarshall(matchResult.Item),
    );
    const statementLine = await TreasuryService.getStatementLine(
      orgId,
      treasuryAccountId,
      year,
      existing.statementLineId,
    );
    const cancelledAt = new Date().toISOString();

    await dynamoClient.send(
      new TransactWriteItemsCommand({
        TransactItems: [
          {
            Update: {
              TableName: config.TABLE_NAME,
              Key: marshall({
                PK: KeyFactory.partitionKey(orgId, year),
                SK: KeyFactory.reconciliationMatchSK(
                  treasuryAccountId,
                  year,
                  matchId,
                ),
              }),
              UpdateExpression:
                "SET #status = :cancelled, cancelledAt = :cancelledAt",
              ConditionExpression: "#status = :active",
              ExpressionAttributeNames: {
                "#status": "status",
              },
              ExpressionAttributeValues: marshall({
                ":cancelled": "CANCELLED",
                ":active": "ACTIVE",
                ":cancelledAt": cancelledAt,
              }),
            },
          },
          {
            Update: {
              TableName: config.TABLE_NAME,
              Key: marshall({
                PK: KeyFactory.partitionKey(orgId, year),
                SK: KeyFactory.bankStatementLineSK(
                  treasuryAccountId,
                  year,
                  statementLine.date,
                  existing.statementLineId,
                ),
              }),
              UpdateExpression:
                "SET #status = :unmatched REMOVE matchedEntryId, matchedLineId, reconciliationMatchId",
              ExpressionAttributeNames: {
                "#status": "status",
              },
              ExpressionAttributeValues: marshall({
                ":unmatched": "UNMATCHED",
              }),
            },
          },
          {
            Update: {
              TableName: config.TABLE_NAME,
              Key: marshall({
                PK: KeyFactory.partitionKey(orgId, year),
                SK: KeyFactory.entryLineSK(existing.lineId),
              }),
              UpdateExpression:
                "SET reconciliationStatus = :unmatched REMOVE statementLineId, reconciledAt, reconciliationMatchId",
              ExpressionAttributeValues: marshall({
                ":unmatched": "UNMATCHED",
              }),
            },
          },
        ],
      }),
    );

    return ReconciliationMatchDtoSchema.parse({
      ...existing,
      status: "CANCELLED",
      cancelledAt,
    });
  }

  static async getSummary(
    orgId: string,
    year: string,
  ): Promise<TreasurySummaryDto> {
    const accounts = await TreasuryService.listAllAccounts(orgId);
    let totalInflows = 0;
    let totalOutflows = 0;
    let unreconciledStatementLines = 0;
    let unreconciledMovements = 0;

    for (const account of accounts) {
      const [movements, statementLines] = await Promise.all([
        TreasuryService.listMovements(orgId, account.treasuryAccountId, year),
        TreasuryService.listStatementLines(
          orgId,
          account.treasuryAccountId,
          year,
        ),
      ]);

      totalInflows += movements
        .filter((movement) => movement.direction === "INFLOW")
        .reduce((sum, movement) => sum + movement.amount, 0);
      totalOutflows += movements
        .filter((movement) => movement.direction === "OUTFLOW")
        .reduce((sum, movement) => sum + movement.amount, 0);
      unreconciledMovements += movements.filter(
        (movement) => movement.reconciliationStatus !== "MATCHED",
      ).length;
      unreconciledStatementLines += statementLines.filter(
        (line) => line.status === "UNMATCHED",
      ).length;
    }

    return {
      year,
      accountsCount: accounts.length,
      totalInflows,
      totalOutflows,
      netCashFlow: totalInflows - totalOutflows,
      unreconciledStatementLines,
      unreconciledMovements,
    };
  }

  private static async listAllAccounts(
    orgId: string,
  ): Promise<TreasuryAccountDto[]> {
    const accounts: TreasuryAccountDto[] = [];
    let cursor: string | undefined;

    do {
      const page = await TreasuryService.listAccounts(orgId, {
        limit: 200,
        cursor,
      });
      accounts.push(...page.accounts);
      cursor = page.nextCursor;
    } while (cursor);

    return accounts;
  }

  private static async assertTreasuryLedgerAccount(
    orgId: string,
    accountId: string,
  ) {
    if (!accountId.startsWith("5")) {
      throw new AppError(400, "ERROR_ACCOUNT_NOT_TREASURY_CLASS");
    }

    const result = await dynamoClient.send(
      new GetItemCommand({
        TableName: config.TABLE_NAME,
        Key: marshall({
          PK: KeyFactory.orgKey(orgId),
          SK: KeyFactory.accountSK(accountId),
        }),
      }),
    );

    if (!result.Item) {
      throw new AppError(404, "ERROR_ACCOUNT_NOT_FOUND");
    }

    const account = AccountSchema.parse(unmarshall(result.Item));
    if (account.orgId !== orgId) {
      throw new AppError(404, "ERROR_ACCOUNT_NOT_FOUND");
    }
    if (!account.isActive) {
      throw new AppError(400, "ERROR_ACCOUNT_NOT_ACTIVE");
    }
    if (account.classCode !== 5) {
      throw new AppError(400, "ERROR_ACCOUNT_NOT_TREASURY_CLASS");
    }
  }

  private static encodeCursor(
    cursor?: Record<string, any>,
  ): string | undefined {
    return cursor
      ? Buffer.from(JSON.stringify(cursor)).toString("base64")
      : undefined;
  }

  private static decodeTreasuryAccountCursor(
    orgId: string,
    cursor?: string,
  ): Record<string, any> | undefined {
    if (!cursor) {
      return undefined;
    }

    try {
      const decoded = JSON.parse(Buffer.from(cursor, "base64").toString());
      const key = unmarshall(decoded);
      if (
        key.PK !== KeyFactory.orgKey(orgId) ||
        typeof key.SK !== "string" ||
        !key.SK.startsWith(KeyFactory.treasuryAccountPrefix())
      ) {
        throw new Error("Invalid treasury account cursor scope");
      }
      return decoded;
    } catch {
      throw new AppError(400, "ERROR_INVALID_CURSOR");
    }
  }

  private static buildStatementLineId(
    treasuryAccountId: string,
    line: ImportBankStatementLine,
  ) {
    return createHash("sha256")
      .update(
        [
          treasuryAccountId,
          line.date,
          line.amount,
          line.reference || "",
          line.label,
        ].join("|"),
      )
      .digest("hex")
      .slice(0, 24);
  }

  private static async getStatementLine(
    orgId: string,
    treasuryAccountId: string,
    year: string,
    statementLineId: string,
  ): Promise<BankStatementLineDto> {
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: config.TABLE_NAME,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
        ExpressionAttributeValues: marshall({
          ":pk": KeyFactory.partitionKey(orgId, year),
          ":sk": KeyFactory.bankStatementLinePrefix(treasuryAccountId, year),
        }),
      }),
    );

    const found = (result.Items || [])
      .map((item) => unmarshall(item))
      .find((item) => item.statementLineId === statementLineId);

    if (!found) {
      throw new AppError(404, "ERROR_STATEMENT_LINE_NOT_FOUND");
    }

    return BankStatementLineDtoSchema.parse(found);
  }

  private static async getEntryLine(
    orgId: string,
    year: string,
    lineId: string,
  ) {
    const result = await dynamoClient.send(
      new GetItemCommand({
        TableName: config.TABLE_NAME,
        Key: marshall({
          PK: KeyFactory.partitionKey(orgId, year),
          SK: KeyFactory.entryLineSK(lineId),
        }),
      }),
    );

    if (!result.Item) {
      throw new AppError(404, "ERROR_ENTRY_LINE_NOT_FOUND");
    }

    return unmarshall(result.Item);
  }
}
