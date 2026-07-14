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
  ListBankStatementLinesRequest,
  ListReconciliationMatchesRequest,
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
    options: Omit<
      ListBankStatementLinesRequest,
      "treasuryAccountId" | "year"
    > = {},
  ): Promise<{
    statementLines: BankStatementLineDto[];
    nextCursor?: string;
    hasMore: boolean;
    count: number;
  }> {
    await TreasuryService.assertActiveTreasuryAccount(orgId, treasuryAccountId);

    const exclusiveStartKey = TreasuryService.decodeStatementLineCursor(
      orgId,
      treasuryAccountId,
      year,
      options.cursor,
    );
    const hasDateRange = !!options.startDate || !!options.endDate;

    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: config.TABLE_NAME,
        KeyConditionExpression: hasDateRange
          ? "PK = :pk AND SK BETWEEN :startSk AND :endSk"
          : "PK = :pk AND begins_with(SK, :sk)",
        ExpressionAttributeValues: marshall({
          ":pk": KeyFactory.partitionKey(orgId, year),
          ...(hasDateRange
            ? {
                ":startSk": KeyFactory.bankStatementLineRangeStart(
                  treasuryAccountId,
                  year,
                  options.startDate,
                ),
                ":endSk": KeyFactory.bankStatementLineRangeEnd(
                  treasuryAccountId,
                  year,
                  options.endDate,
                ),
              }
            : {
                ":sk": KeyFactory.bankStatementLinePrefix(
                  treasuryAccountId,
                  year,
                ),
              }),
        }),
        ExclusiveStartKey: exclusiveStartKey,
        Limit: options.limit ?? 100,
        ScanIndexForward: true,
      }),
    );

    const statementLines = (result.Items || [])
      .map((item) => BankStatementLineDtoSchema.parse(unmarshall(item)))
      // The Query is already scoped to one org, fiscal year, and treasury account.
      // Status and direction are post-query MVP filters until a dedicated access
      // pattern justifies a sparse index.
      .filter(
        (line) => !options.status || line.status === options.status,
      )
      .filter(
        (line) => !options.direction || line.direction === options.direction,
      );

    const nextCursor = TreasuryService.encodeCursor(result.LastEvaluatedKey);

    return {
      statementLines,
      nextCursor,
      hasMore: !!nextCursor,
      count: statementLines.length,
    };
  }

  static async importStatementLines(params: {
    orgId: string;
    treasuryAccountId: string;
    year: string;
    lines: ImportBankStatementLine[];
  }): Promise<{
    imported: number;
    skipped: number;
    rejected: number;
    errors: { index: number; message: string }[];
    statementLines: BankStatementLineDto[];
  }> {
    const { orgId, treasuryAccountId, year, lines } = params;
    const account = await TreasuryService.assertActiveTreasuryAccount(
      orgId,
      treasuryAccountId,
    );
    const importedLines: BankStatementLineDto[] = [];
    const errors: { index: number; message: string }[] = [];
    let imported = 0;
    let skipped = 0;

    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      try {
        const statementLineId = TreasuryService.buildStatementLineId(
          treasuryAccountId,
          year,
          line,
        );
        const importedAt = new Date().toISOString();
        const item = BankStatementLineSchema.parse({
          orgId,
          treasuryAccountId,
          statementLineId,
          year,
          statementDate: line.statementDate,
          date: line.statementDate,
          valueDate: line.valueDate,
          reference: line.reference,
          externalId: line.externalId,
          description: line.description,
          label: line.description,
          amount: line.amount,
          direction: line.direction,
          currency: line.currency || account.currency,
          status: "UNMATCHED",
          rawData: line.rawData,
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
                  line.statementDate,
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
            message: error?.message || "INVALID_BANK_STATEMENT_LINE",
          });
        }
      }
    }

    return {
      imported,
      skipped,
      rejected: errors.length,
      errors,
      statementLines: importedLines,
    };
  }

  static async reconcile(
    orgId: string,
    userId: string,
    input: CreateReconciliationRequest,
  ): Promise<ReconciliationMatchDto> {
    const movementLineId = input.movementLineId ?? input.lineId;
    if (!movementLineId) {
      throw new AppError(400, "ERROR_INVALID_RECONCILIATION_REQUEST");
    }

    const account = await TreasuryService.assertReconciliationTreasuryAccount(
      orgId,
      input.treasuryAccountId,
    );
    const statementLine =
      await TreasuryService.getStatementLineByDateUnchecked(
        orgId,
        input.treasuryAccountId,
        input.year,
        input.statementDate,
        input.statementLineId,
      );
    const entryLine = await TreasuryService.getEntryLine(
      orgId,
      input.year,
      movementLineId,
    );

    if (
      statementLine.treasuryAccountId !== input.treasuryAccountId ||
      statementLine.year !== input.year ||
      statementLine.statementDate !== input.statementDate
    ) {
      throw new AppError(404, "ERROR_BANK_STATEMENT_LINE_NOT_FOUND");
    }
    if (statementLine.status !== "UNMATCHED") {
      throw new AppError(400, "ERROR_BANK_STATEMENT_LINE_ALREADY_RECONCILED");
    }

    TreasuryService.assertEligibleMovementLine(entryLine, orgId, input.year);
    if (entryLine.accountId !== account.accountId) {
      throw new AppError(400, "ERROR_RECONCILIATION_ACCOUNT_MISMATCH");
    }

    TreasuryService.assertDirectionAwareAmountMatch(statementLine, entryLine);

    const now = new Date().toISOString();
    const matchId = `RCN-${randomUUID()}`;
    const match = ReconciliationMatchSchema.parse({
      orgId,
      treasuryAccountId: input.treasuryAccountId,
      matchId,
      year: input.year,
      statementLineId: input.statementLineId,
      statementDate: input.statementDate,
      movementLineId,
      entryId: input.entryId ?? entryLine.entryId,
      lineId: movementLineId,
      amount: statementLine.amount,
      direction: statementLine.direction,
      status: "ACTIVE",
      matchedAt: now,
      matchedBy: userId,
      statementReference: statementLine.reference,
      statementDescription: statementLine.description,
      entityType: "RECONCILIATION_MATCH",
    });

    try {
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
                    input.statementDate,
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
                  ":entryId": input.entryId ?? entryLine.entryId,
                  ":lineId": movementLineId,
                  ":matchId": matchId,
                }),
              },
            },
            {
              Update: {
                TableName: config.TABLE_NAME,
                Key: marshall({
                  PK: KeyFactory.partitionKey(orgId, input.year),
                  SK: KeyFactory.entryLineSK(movementLineId),
                }),
                UpdateExpression:
                  "SET reconciliationStatus = :matched, statementLineId = :statementLineId, statementDate = :statementDate, reconciledAt = :now, reconciliationMatchId = :matchId",
                ConditionExpression:
                  "attribute_exists(PK) AND attribute_exists(SK) AND attribute_not_exists(reconciliationMatchId)",
                ExpressionAttributeValues: marshall({
                  ":matched": "MATCHED",
                  ":statementLineId": input.statementLineId,
                  ":statementDate": input.statementDate,
                  ":now": now,
                  ":matchId": matchId,
                }),
              },
            },
          ],
        }),
      );
    } catch (error: any) {
      if (error?.name === "ConditionalCheckFailedException") {
        throw new AppError(400, "ERROR_ACCOUNTING_MOVEMENT_ALREADY_RECONCILED");
      }
      throw error;
    }

    return ReconciliationMatchDtoSchema.parse(match);
  }

  static async cancelReconciliation(
    orgId: string,
    treasuryAccountId: string,
    year: string,
    matchId: string,
    cancelledBy?: string,
    cancelReason?: string,
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
    if (existing.status === "CANCELLED") {
      throw new AppError(400, "ERROR_RECONCILIATION_MATCH_ALREADY_CANCELLED");
    }

    const cancelledAt = new Date().toISOString();
    const movementLineId = existing.movementLineId ?? existing.lineId;
    const cancelSetExpressions = [
      "#status = :cancelled",
      "cancelledAt = :cancelledAt",
    ];
    const cancelExpressionValues: Record<string, string> = {
      ":cancelled": "CANCELLED",
      ":active": "ACTIVE",
      ":cancelledAt": cancelledAt,
    };
    if (cancelledBy) {
      cancelSetExpressions.push("cancelledBy = :cancelledBy");
      cancelExpressionValues[":cancelledBy"] = cancelledBy;
    }
    if (cancelReason) {
      cancelSetExpressions.push("cancelReason = :cancelReason");
      cancelExpressionValues[":cancelReason"] = cancelReason;
    }

    try {
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
                UpdateExpression: `SET ${cancelSetExpressions.join(", ")}`,
                ConditionExpression: "#status = :active",
                ExpressionAttributeNames: {
                  "#status": "status",
                },
                ExpressionAttributeValues: marshall(cancelExpressionValues),
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
                    existing.statementDate,
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
                  SK: KeyFactory.entryLineSK(movementLineId),
                }),
                UpdateExpression:
                  "SET reconciliationStatus = :unmatched REMOVE statementLineId, statementDate, reconciledAt, reconciliationMatchId",
                ExpressionAttributeValues: marshall({
                  ":unmatched": "UNMATCHED",
                }),
              },
            },
          ],
        }),
      );
    } catch (error: any) {
      if (error?.name === "ConditionalCheckFailedException") {
        throw new AppError(400, "ERROR_RECONCILIATION_MATCH_ALREADY_CANCELLED");
      }
      throw error;
    }

    return ReconciliationMatchDtoSchema.parse({
      ...existing,
      status: "CANCELLED",
      cancelledAt,
      cancelledBy,
      cancelReason,
    });
  }

  static async listReconciliationMatches(
    orgId: string,
    options: ListReconciliationMatchesRequest,
  ): Promise<{
    matches: ReconciliationMatchDto[];
    nextCursor?: string;
    hasMore: boolean;
    count: number;
  }> {
    await TreasuryService.assertActiveTreasuryAccount(
      orgId,
      options.treasuryAccountId,
    );

    const exclusiveStartKey = TreasuryService.decodeReconciliationCursor(
      orgId,
      options.treasuryAccountId,
      options.year,
      options.cursor,
    );
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: config.TABLE_NAME,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
        ExpressionAttributeValues: marshall({
          ":pk": KeyFactory.partitionKey(orgId, options.year),
          ":sk": KeyFactory.reconciliationMatchPrefix(
            options.treasuryAccountId,
            options.year,
          ),
        }),
        ExclusiveStartKey: exclusiveStartKey,
        Limit: options.limit ?? 100,
      }),
    );

    const matches = (result.Items || [])
      .map((item) => unmarshall(item))
      .filter((item) => item.entityType === "RECONCILIATION_MATCH")
      .filter((item) => !options.status || item.status === options.status)
      .map((item) => ReconciliationMatchDtoSchema.parse(item));

    return {
      matches,
      nextCursor: TreasuryService.encodeCursor(result.LastEvaluatedKey),
      hasMore: Boolean(result.LastEvaluatedKey),
      count: matches.length,
    };
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
        TreasuryService.listAllStatementLines(
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

  private static async listAllStatementLines(
    orgId: string,
    treasuryAccountId: string,
    year: string,
  ): Promise<BankStatementLineDto[]> {
    const statementLines: BankStatementLineDto[] = [];
    let cursor: string | undefined;

    do {
      const page = await TreasuryService.listStatementLines(
        orgId,
        treasuryAccountId,
        year,
        { limit: 200, cursor },
      );
      statementLines.push(...page.statementLines);
      cursor = page.nextCursor;
    } while (cursor);

    return statementLines;
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

  private static async assertActiveTreasuryAccount(
    orgId: string,
    treasuryAccountId: string,
  ): Promise<TreasuryAccountDto> {
    const account = await TreasuryService.getAccount(orgId, treasuryAccountId);
    if (!account.active) {
      throw new AppError(400, "ERROR_TREASURY_ACCOUNT_INACTIVE");
    }
    return account;
  }

  private static async assertReconciliationTreasuryAccount(
    orgId: string,
    treasuryAccountId: string,
  ): Promise<TreasuryAccountDto> {
    const account = await TreasuryService.assertActiveTreasuryAccount(
      orgId,
      treasuryAccountId,
    );
    const result = await dynamoClient.send(
      new GetItemCommand({
        TableName: config.TABLE_NAME,
        Key: marshall({
          PK: KeyFactory.orgKey(orgId),
          SK: KeyFactory.accountSK(account.accountId),
        }),
      }),
    );

    if (!result.Item) {
      throw new AppError(404, "ERROR_ACCOUNT_NOT_FOUND");
    }

    const ledgerAccount = AccountSchema.parse(unmarshall(result.Item));
    if (ledgerAccount.orgId !== orgId) {
      throw new AppError(404, "ERROR_ACCOUNT_NOT_FOUND");
    }
    if (!ledgerAccount.isActive) {
      throw new AppError(400, "ERROR_ACCOUNT_NOT_ACTIVE");
    }
    if (!ledgerAccount.allowReconciliation) {
      throw new AppError(
        400,
        "ERROR_TREASURY_ACCOUNT_RECONCILIATION_DISABLED",
      );
    }

    return account;
  }

  private static assertEligibleMovementLine(
    entryLine: Record<string, any>,
    orgId: string,
    year: string,
  ) {
    if (
      entryLine.orgId !== orgId ||
      (entryLine.year && String(entryLine.year) !== year) ||
      (entryLine.fiscalYear && String(entryLine.fiscalYear) !== year) ||
      (entryLine.PK && entryLine.PK !== KeyFactory.partitionKey(orgId, year))
    ) {
      throw new AppError(404, "ERROR_ACCOUNTING_MOVEMENT_NOT_FOUND");
    }
    if (entryLine.status === "DRAFT" || entryLine.entryStatus === "DRAFT") {
      throw new AppError(404, "ERROR_ACCOUNTING_MOVEMENT_NOT_FOUND");
    }
    if (
      entryLine.reconciliationStatus === "MATCHED" ||
      entryLine.reconciliationMatchId ||
      entryLine.statementLineId
    ) {
      throw new AppError(400, "ERROR_ACCOUNTING_MOVEMENT_ALREADY_RECONCILED");
    }
  }

  private static assertDirectionAwareAmountMatch(
    statementLine: BankStatementLineDto,
    entryLine: Record<string, any>,
  ) {
    const debit = Number(entryLine.debit || 0);
    const credit = Number(entryLine.credit || 0);
    const expectedAmount =
      statementLine.direction === "INFLOW" ? debit : credit;
    const oppositeAmount =
      statementLine.direction === "INFLOW" ? credit : debit;

    if (expectedAmount !== statementLine.amount) {
      if (oppositeAmount === statementLine.amount) {
        throw new AppError(400, "ERROR_RECONCILIATION_DIRECTION_MISMATCH");
      }
      throw new AppError(400, "ERROR_RECONCILIATION_AMOUNT_MISMATCH");
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

  private static decodeStatementLineCursor(
    orgId: string,
    treasuryAccountId: string,
    year: string,
    cursor?: string,
  ): Record<string, any> | undefined {
    if (!cursor) {
      return undefined;
    }

    try {
      const decoded = JSON.parse(Buffer.from(cursor, "base64").toString());
      const key = unmarshall(decoded);
      if (
        key.PK !== KeyFactory.partitionKey(orgId, year) ||
        typeof key.SK !== "string" ||
        !key.SK.startsWith(
          KeyFactory.bankStatementLinePrefix(treasuryAccountId, year),
        )
      ) {
        throw new Error("Invalid bank statement cursor scope");
      }
      return decoded;
    } catch {
      throw new AppError(400, "ERROR_INVALID_TREASURY_CURSOR");
    }
  }

  private static decodeReconciliationCursor(
    orgId: string,
    treasuryAccountId: string,
    year: string,
    cursor?: string,
  ): Record<string, any> | undefined {
    if (!cursor) {
      return undefined;
    }

    try {
      const decoded = JSON.parse(Buffer.from(cursor, "base64").toString());
      const key = unmarshall(decoded);
      if (
        key.PK !== KeyFactory.partitionKey(orgId, year) ||
        typeof key.SK !== "string" ||
        !key.SK.startsWith(
          KeyFactory.reconciliationMatchPrefix(treasuryAccountId, year),
        )
      ) {
        throw new Error("Invalid reconciliation cursor scope");
      }
      return decoded;
    } catch {
      throw new AppError(400, "ERROR_INVALID_TREASURY_CURSOR");
    }
  }

  private static buildStatementLineId(
    treasuryAccountId: string,
    year: string,
    line: ImportBankStatementLine,
  ) {
    return createHash("sha256")
      .update(
        [
          treasuryAccountId,
          year,
          line.statementDate,
          line.externalId || "",
          line.direction,
          line.amount,
          line.reference || "",
          line.description,
        ].join("|"),
      )
      .digest("hex")
      .slice(0, 24);
  }

  static async getStatementLineByDate(
    orgId: string,
    treasuryAccountId: string,
    year: string,
    statementDate: string,
    statementLineId: string,
  ): Promise<BankStatementLineDto> {
    await TreasuryService.assertActiveTreasuryAccount(orgId, treasuryAccountId);

    return TreasuryService.getStatementLineByDateUnchecked(
      orgId,
      treasuryAccountId,
      year,
      statementDate,
      statementLineId,
    );
  }

  private static async getStatementLineByDateUnchecked(
    orgId: string,
    treasuryAccountId: string,
    year: string,
    statementDate: string,
    statementLineId: string,
  ): Promise<BankStatementLineDto> {
    const result = await dynamoClient.send(
      new GetItemCommand({
        TableName: config.TABLE_NAME,
        Key: marshall({
          PK: KeyFactory.partitionKey(orgId, year),
          SK: KeyFactory.bankStatementLineSK(
            treasuryAccountId,
            year,
            statementDate,
            statementLineId,
          ),
        }),
      }),
    );

    if (!result.Item) {
      throw new AppError(404, "ERROR_BANK_STATEMENT_LINE_NOT_FOUND");
    }

    return BankStatementLineDtoSchema.parse(unmarshall(result.Item));
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
      throw new AppError(404, "ERROR_ACCOUNTING_MOVEMENT_NOT_FOUND");
    }

    return unmarshall(result.Item);
  }
}
