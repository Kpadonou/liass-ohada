import { Account, AccountSchema } from "@liass-ohada/shared/accounting";
import {
  CreateEntryRequest,
  EntryLineSchema,
  EntrySchema,
} from "@liass-ohada/shared/accounting";
import { FiscalYearSchema } from "@liass-ohada/shared/accounting";
import {
  BatchGetItemCommand,
  GetItemCommand,
  PutItemCommand,
  QueryCommand,
  TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { randomUUID } from "crypto";
import { config } from "../config";
import { dynamoClient } from "../dynamo-client";
import { KeyFactory } from "../key-builder";
import { AppError } from "../middleware/handler-wrapper";
import { BalanceService } from "./balance-service";
import { BudgetService } from "./budget-service";

/**
 * Interface definitions for Ledger queries
 */
export interface AccountEntriesOptions {
  limit?: number;
  cursor?: string;
}

export interface AccountEntry {
  entryId: string;
  accountId: string;
  debit: number;
  credit: number;
  description?: string;
  entryDate: string;
  voucherNumber?: string;
  journalCode?: string;
  thirdPartyId?: string;
  createdAt: string;
}

export interface AccountEntriesResult {
  entries: AccountEntry[];
  nextCursor?: string;
  hasMore: boolean;
}

export interface LedgerEntry {
  date: string;
  label: string;
  reference: string;
  journal: string;
  debit: number;
  credit: number;
  runningBalance: number;
}

export interface PostEntryParams {
  orgId: string;
  userId: string;
  data: CreateEntryRequest;
}

/**
 * Service handling Accounting operations and validations.
 */
export class LedgerService {
  /**
   * Posts a balanced accounting entry and its lines in one atomic transaction.
   */
  static async postEntry({ orgId, userId, data }: PostEntryParams) {
    const {
      year,
      entryDate: inputDate,
      lines = [],
      label: headerLabel,
      journalCode = "MISC",
      entryType = "STANDARD",
      voucherNumber,
    } = data;

    if (lines.length === 0) {
      throw new AppError(400, "ERROR_EMPTY_ENTRY");
    }

    // DynamoDB transaction limit is 100 items: 1 header + 2 actions per line.
    if (lines.length > 49) {
      throw new AppError(400, "ERROR_ENTRY_TOO_LARGE");
    }

    const entryDate = inputDate || new Date().toISOString().split("T")[0];
    const entryId = data.entryId || `E-${randomUUID()}`;
    const now = new Date().toISOString();

    await LedgerService.validateFiscalYear(orgId, year);
    if (await LedgerService.isPeriodLocked(orgId, entryDate)) {
      throw new AppError(400, "ERROR_PERIOD_LOCKED");
    }

    const accountIds = [
      ...new Set(lines.map((line) => LedgerService.formatAccount(line.accountId))),
    ];
    const projectIds = [
      ...new Set(
        lines
          .map((line) => line.projectId)
          .filter((projectId): projectId is string => !!projectId),
      ),
    ];

    await LedgerService.validateEntities(orgId, accountIds, projectIds);

    let totalDebit = 0;
    let totalCredit = 0;
    const transactItems: any[] = [];

    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      const paddedAccountId = LedgerService.formatAccount(line.accountId);
      const lineId = `L-${index + 1}-${randomUUID()}`;

      if (line.projectId && line.debit > 0) {
        await BudgetService.enforceBudget(orgId, year, line);
      }

      const lineItem = LedgerService.buildEntryLineItem({
        orgId,
        year,
        entryId,
        lineId,
        entryDate,
        line,
        paddedAccountId,
        journalCode,
        voucherNumber,
        userId,
        now,
      });

      transactItems.push({
        Put: {
          TableName: config.TABLE_NAME,
          Item: marshall(EntryLineSchema.parse(lineItem), {
            removeUndefinedValues: true,
          }),
          ConditionExpression: "attribute_not_exists(PK)",
        },
      });

      transactItems.push(
        BalanceService.buildBalanceUpdateAction(
          orgId,
          year,
          paddedAccountId,
          line.debit || 0,
          line.credit || 0,
          journalCode,
          userId,
        ),
      );

      totalDebit += Math.round(line.debit || 0);
      totalCredit += Math.round(line.credit || 0);
    }

    if (totalDebit !== totalCredit) {
      throw new AppError(400, "ERROR_ENTRY_NOT_BALANCED");
    }

    const entryHeader = {
      orgId,
      year,
      entryId,
      entryType,
      entryDate,
      journalCode,
      voucherNumber,
      totalDebit,
      totalCredit,
      label: headerLabel,
      status: "POSTED",
      entityType: "ENTRY",
      PK: KeyFactory.partitionKey(orgId, year),
      SK: KeyFactory.entrySK(entryId),
      GSI5PK: KeyFactory.gsi5JournalPK(orgId, year),
      GSI5SK: KeyFactory.gsi5JournalSK(journalCode, entryDate, entryId),
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    };

    transactItems.unshift({
      Put: {
        TableName: config.TABLE_NAME,
        Item: marshall(EntrySchema.parse(entryHeader), {
          removeUndefinedValues: true,
        }),
        ConditionExpression: "attribute_not_exists(PK)",
      },
    });

    try {
      await dynamoClient.send(
        new TransactWriteItemsCommand({ TransactItems: transactItems }),
      );
    } catch (error: any) {
      if (error?.name === "TransactionCanceledException") {
        throw new AppError(409, "ERROR_ENTRY_ALREADY_EXISTS", { entryId });
      }
      throw error;
    }

    return { entryId };
  }

  /**
   * Validates that a fiscal year exists and its status is "OPEN".
   * Throws AppError if validation fails.
   */
  static async validateFiscalYear(orgId: string, year: number): Promise<void> {
    const result = await dynamoClient.send(
      new GetItemCommand({
        TableName: config.TABLE_NAME,
        Key: marshall({
          PK: KeyFactory.orgKey(orgId),
          SK: KeyFactory.fiscalYearSK(year),
        }),
      }),
    );

    if (!result.Item) {
      throw new AppError(404, "ERROR_FISCAL_YEAR_NOT_FOUND");
    }

    const fiscalYear = FiscalYearSchema.parse(unmarshall(result.Item));
    if (fiscalYear.status !== "OPEN") {
      throw new AppError(400, "ERROR_FISCAL_YEAR_LOCKED");
    }
  }

  /**
   * Retrieves a fiscal year record by org and year.
   * Throws AppError(404) when not found.
   */
  static async getFiscalYear(orgId: string, year: string | number) {
    const result = await dynamoClient.send(
      new GetItemCommand({
        TableName: config.TABLE_NAME,
        Key: marshall({
          PK: KeyFactory.orgKey(orgId),
          SK: KeyFactory.fiscalYearSK(year),
        }),
      }),
    );

    if (!result.Item) {
      throw new AppError(404, "ERROR_FISCAL_YEAR_NOT_FOUND");
    }

    return FiscalYearSchema.parse(unmarshall(result.Item));
  }

  /**
   * Validates the existence of multiple accounts and projects in a single batch.
   * Throws AppError if any entity is missing.
   */
  static async validateEntities(
    orgId: string,
    accountIds: string[],
    projectIds: string[],
  ): Promise<void> {
    if (accountIds.length === 0 && projectIds.length === 0) return;

    const keys = [
      ...accountIds.map((id) =>
        marshall({
          PK: KeyFactory.orgKey(orgId),
          SK: KeyFactory.accountSK(id),
        }),
      ),
      ...projectIds.map((id) =>
        marshall({
          PK: KeyFactory.orgKey(orgId),
          SK: KeyFactory.projectSK(id),
        }),
      ),
    ];

    const result = await dynamoClient.send(
      new BatchGetItemCommand({
        RequestItems: {
          [config.TABLE_NAME]: { Keys: keys },
        },
      }),
    );

    const foundItems = result.Responses?.[config.TABLE_NAME] || [];
    const expectedCount = accountIds.length + projectIds.length;

    if (foundItems.length !== expectedCount) {
      throw new AppError(400, "ERROR_ACCOUNT_OR_PROJECT_NOT_FOUND");
    }
  }

  /**
   * Verifies whether an account exists in the chart of accounts.
   */
  static async accountExists(
    orgId: string,
    accountId: string,
  ): Promise<boolean> {
    const result = await dynamoClient.send(
      new GetItemCommand({
        TableName: config.TABLE_NAME,
        Key: marshall({
          PK: KeyFactory.orgKey(orgId),
          SK: KeyFactory.accountSK(accountId),
        }),
      }),
    );

    return !!result.Item;
  }

  /**
   * Throws when account exists.
   */
  static async assertAccountNotExists(
    orgId: string,
    accountId: string,
  ): Promise<void> {
    if (await LedgerService.accountExists(orgId, accountId)) {
      throw new AppError(400, "ERROR_ACCOUNT_ALREADY_EXISTS");
    }
  }

  /**
   * Creates account item in DynamoDB with conditional write.
   */
  static async createAccount(account: Account): Promise<void> {
    try {
      await dynamoClient.send(
        new PutItemCommand({
          TableName: config.TABLE_NAME,
          Item: marshall(AccountSchema.parse(account)),
          ConditionExpression:
            "attribute_not_exists(PK) AND attribute_not_exists(SK)",
        }),
      );
    } catch (error: any) {
      if (error?.name === "ConditionalCheckFailedException") {
        throw new AppError(400, "ERROR_ACCOUNT_ALREADY_EXISTS");
      }
      throw error;
    }
  }

  /**
   * Retrieves an account by ID.
   * Throws AppError(404) if not found.
   */
  static async getAccount(orgId: string, accountId: string): Promise<Account> {
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

    return AccountSchema.parse(unmarshall(result.Item));
  }

  /**
   * Retrieves paginated entries for a specific account.
   */
  static async getAccountEntries(
    orgId: string,
    fiscalYear: string,
    accountId: string,
    options?: AccountEntriesOptions,
  ): Promise<AccountEntriesResult> {
    const paddedAccountId = accountId.padEnd(8, "0");
    const { limit = 50, cursor } = options || {};

    let exclusiveStartKey: any = undefined;
    if (cursor) {
      try {
        exclusiveStartKey = JSON.parse(
          Buffer.from(cursor, "base64").toString(),
        );
      } catch {
        throw new AppError(400, "ERROR_INVALID_CURSOR");
      }
    }

    const queryResult = await dynamoClient.send(
      new QueryCommand({
        TableName: config.TABLE_NAME,
        IndexName: config.GSI1,
        KeyConditionExpression: "GSI1PK = :pk AND begins_with(GSI1SK, :sk)",
        ExpressionAttributeValues: marshall({
          ":pk": KeyFactory.gsi1PK(orgId),
          ":sk": KeyFactory.gsi1SKPrefix(paddedAccountId, fiscalYear),
        }),
        Limit: limit,
        ExclusiveStartKey: exclusiveStartKey,
        ScanIndexForward: true,
      }),
    );

    const entries = (queryResult.Items || []).map((item) => {
      const data = unmarshall(item);
      return {
        entryId: data.entryId,
        accountId: data.accountId,
        debit: data.debit || 0,
        credit: data.credit || 0,
        description: data.description,
        entryDate: data.entryDate,
        voucherNumber: data.voucherNumber,
        journalCode: data.journalCode,
        thirdPartyId: data.thirdPartyId,
        createdAt: data.createdAt,
      };
    });

    const nextCursor = queryResult.LastEvaluatedKey
      ? Buffer.from(JSON.stringify(queryResult.LastEvaluatedKey)).toString(
          "base64",
        )
      : undefined;

    return {
      entries,
      nextCursor,
      hasMore: !!nextCursor,
    };
  }

  static async getGeneralLedger(
    orgId: string,
    fiscalYear: string,
    accountId: string,
  ) {
    const paddedAccountId = LedgerService.formatAccount(accountId);
    const accountBalance = await BalanceService.getAccountBalance(
      orgId,
      fiscalYear,
      paddedAccountId,
    );

    const openingNet =
      accountBalance.openingDebit - accountBalance.openingCredit;

    const queryResult = await dynamoClient.send(
      new QueryCommand({
        TableName: config.TABLE_NAME,
        IndexName: config.GSI1,
        KeyConditionExpression:
          "GSI1PK = :gsi1pk AND begins_with(GSI1SK, :gsi1sk)",
        ExpressionAttributeValues: marshall({
          ":gsi1pk": KeyFactory.gsi1PK(orgId),
          ":gsi1sk": KeyFactory.gsi1SKPrefix(paddedAccountId, fiscalYear),
        }),
        ScanIndexForward: true,
      }),
    );

    let runningBalance = openingNet;
    const movements: LedgerEntry[] = [];

    for (const item of queryResult.Items || []) {
      const line = unmarshall(item);
      if (line.journalCode === "RAN") continue;

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

    return {
      accountId: paddedAccountId,
      openingBalance: {
        date: "OPENING",
        label: "Opening Balance (Report à Nouveau)",
        reference: "RAN",
        journal: "RAN",
        debit: accountBalance.openingDebit,
        credit: accountBalance.openingCredit,
        runningBalance: openingNet,
      },
      movements,
      finalBalance: runningBalance,
    };
  }

  static async getIncomeStatement(orgId: string, year: number) {
    await LedgerService.getFiscalYear(orgId, year);

    const fetchClassTotals = async (classPrefix: string) => {
      let lastEvaluatedKey: any = undefined;
      let classDebit = 0;
      let classCredit = 0;

      do {
        const queryResult = await dynamoClient.send(
          new QueryCommand({
            TableName: config.TABLE_NAME,
            IndexName: config.GSI1,
            KeyConditionExpression: "GSI1PK = :pk AND begins_with(GSI1SK, :sk)",
            ExpressionAttributeValues: marshall({
              ":pk": KeyFactory.gsi1PK(orgId),
              ":sk": `ACC#${classPrefix}`,
            }),
            ExclusiveStartKey: lastEvaluatedKey,
          }),
        );

        for (const item of queryResult.Items || []) {
          const line = unmarshall(item);
          if (Number(line.year) === year) {
            classDebit += Number(line.debit) || 0;
            classCredit += Number(line.credit) || 0;
          }
        }

        lastEvaluatedKey = queryResult.LastEvaluatedKey;
      } while (lastEvaluatedKey);

      return { classDebit, classCredit };
    };

    const [expensesData, revenueData] = await Promise.all([
      fetchClassTotals("6"),
      fetchClassTotals("7"),
    ]);

    const totalExpenses = expensesData.classDebit - expensesData.classCredit;
    const totalRevenue = revenueData.classCredit - revenueData.classDebit;
    const netResult = totalRevenue - totalExpenses;

    return {
      fiscalYear: year.toString(),
      totalRevenue,
      totalExpenses,
      netResult,
      performanceStatus: netResult >= 0 ? "PROFIT" : "LOSS",
    };
  }

  private static formatAccount(accountId: string): string {
    return accountId.padEnd(8, "0");
  }

  private static async isPeriodLocked(
    orgId: string,
    date: string,
  ): Promise<boolean> {
    const yearPart = date.substring(0, 4);
    const monthPart = date.substring(5, 7);

    const result = await dynamoClient.send(
      new GetItemCommand({
        TableName: config.TABLE_NAME,
        Key: marshall({
          PK: KeyFactory.partitionKey(orgId, yearPart),
          SK: KeyFactory.periodLockSK(monthPart),
        }),
      }),
    );

    if (!result.Item) return false;

    const lock = unmarshall(result.Item);
    return lock.status === "LOCKED";
  }

  private static buildEntryLineItem(params: {
    orgId: string;
    year: number;
    entryId: string;
    lineId: string;
    entryDate: string;
    line: CreateEntryRequest["lines"][number];
    paddedAccountId: string;
    journalCode: string;
    voucherNumber?: string;
    userId: string;
    now: string;
  }) {
    const {
      orgId,
      year,
      entryId,
      lineId,
      entryDate,
      line,
      paddedAccountId,
      journalCode,
      voucherNumber,
      userId,
      now,
    } = params;

    const item: any = {
      orgId,
      year,
      lineId,
      entryId,
      entryDate,
      journalCode,
      voucherNumber,
      accountId: paddedAccountId,
      projectId: line.projectId,
      budgetLineId: line.budgetLineId,
      donorId: line.donorId,
      thirdPartyId: line.thirdPartyId,
      label: line.label,
      description: line.description,
      debit: Math.round(line.debit || 0),
      credit: Math.round(line.credit || 0),
      entityType: "ENTRY_LINE",
      PK: KeyFactory.partitionKey(orgId, year),
      SK: KeyFactory.entryLineSK(lineId),
      GSI1PK: KeyFactory.gsi1PK(orgId),
      GSI1SK: KeyFactory.gsi1SK(paddedAccountId, year, entryDate, lineId),
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    };

    if (line.thirdPartyId) {
      item.GSI2PK = KeyFactory.gsi2PK(orgId, paddedAccountId, line.thirdPartyId);
      item.GSI2SK = KeyFactory.gsi2SK(entryDate, lineId);
      item.GSI3PK = KeyFactory.letteringPK(
        orgId,
        paddedAccountId,
        line.thirdPartyId,
      );
      item.GSI3SK = KeyFactory.letteringSK(entryDate, entryId, lineId);
    }

    if (line.projectId) {
      item.GSI4PK = KeyFactory.gsi4PK(orgId);
      item.GSI4SK = KeyFactory.gsi4SK(
        line.projectId,
        year,
        entryDate,
        lineId,
      );
    }

    return item;
  }
}
