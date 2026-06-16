import { Account, AccountDto, AccountDtoSchema, AccountSchema } from "@liass-ohada/shared/accounting";
import {
  CreateEntryRequest,
  EntrySummaryDto,
  EntrySummaryDtoSchema,
  EntryLineSchema,
  EntrySchema,
} from "@liass-ohada/shared/accounting";
import { FiscalYear, FiscalYearSchema } from "@liass-ohada/shared/accounting";
import {
  BatchGetItemCommand,
  GetItemCommand,
  PutItemCommand,
  QueryCommand,
  TransactWriteItemsCommand,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { randomUUID } from "crypto";
import { config } from "../config";
import { dynamoClient } from "../dynamo-client";
import { KeyFactory } from "../key-builder";
import { AppError } from "../middleware/handler-wrapper";
import { BalanceService } from "./balance-service";
import { BudgetService } from "./budget-service";
import { JournalService } from "./journal-service";

/**
 * Interface definitions for Ledger queries
 */
export interface AccountEntriesOptions {
  limit?: number;
  cursor?: string;
}

export interface ListAccountsOptions {
  limit?: number;
  cursor?: string;
}

export interface ListAccountsResult {
  accounts: AccountDto[];
  nextCursor?: string;
  hasMore: boolean;
}

export interface ListEntriesOptions {
  year: string;
  journalCode?: string;
  month?: string;
  limit?: number;
  cursor?: string;
}

export interface ListEntriesResult {
  entries: EntrySummaryDto[];
  nextCursor?: string;
  hasMore: boolean;
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

const SYSTEM_JOURNAL_CODES = new Set(["RAN", "OD", "CLOSING"]);

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
    const normalizedJournalCode = journalCode.toUpperCase();

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

    const fiscalYear = await LedgerService.validateFiscalYear(orgId, year);
    LedgerService.assertEntryDateInFiscalYear(entryDate, fiscalYear);
    LedgerService.validateOpeningEntryRules({
      entryType,
      entryDate,
      fiscalYear,
      journalCode: normalizedJournalCode,
      lines,
    });
    await LedgerService.validateJournalForPosting(orgId, normalizedJournalCode);

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
        journalCode: normalizedJournalCode,
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
          ConditionExpression:
            "attribute_not_exists(PK) AND attribute_not_exists(SK)",
        },
      });

      transactItems.push(
        BalanceService.buildBalanceUpdateAction(
          orgId,
          year,
          paddedAccountId,
          line.debit || 0,
          line.credit || 0,
          normalizedJournalCode,
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
      journalCode: normalizedJournalCode,
      voucherNumber,
      totalDebit,
      totalCredit,
      label: headerLabel,
      status: "POSTED",
      entityType: "ENTRY",
      PK: KeyFactory.partitionKey(orgId, year),
      SK: KeyFactory.entrySK(entryId),
      GSI5PK: KeyFactory.gsi5JournalPK(orgId, year),
      GSI5SK: KeyFactory.gsi5JournalSK(
        normalizedJournalCode,
        entryDate,
        entryId,
      ),
      createdBy: userId,
      createdAt: now,
      updatedBy: userId,
      updatedAt: now,
    };

    transactItems.unshift({
      Put: {
        TableName: config.TABLE_NAME,
        Item: marshall(EntrySchema.parse(entryHeader), {
          removeUndefinedValues: true,
        }),
        ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
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
  static async validateFiscalYear(
    orgId: string,
    year: number,
  ): Promise<FiscalYear> {
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

    return fiscalYear;
  }

  static assertEntryDateInFiscalYear(
    entryDate: string,
    fiscalYear: FiscalYear,
  ): void {
    if (
      entryDate < fiscalYear.startDate ||
      entryDate > fiscalYear.endDate ||
      !entryDate.startsWith(`${fiscalYear.year}-`)
    ) {
      throw new AppError(400, "ERROR_ENTRY_DATE_OUTSIDE_FISCAL_YEAR");
    }
  }

  static async validateJournalForPosting(
    orgId: string,
    journalCode: string,
  ): Promise<void> {
    if (SYSTEM_JOURNAL_CODES.has(journalCode)) {
      return;
    }

    await JournalService.getJournal(orgId, journalCode);
  }

  static validateOpeningEntryRules(params: {
    entryType: string;
    entryDate: string;
    fiscalYear: FiscalYear;
    journalCode: string;
    lines: CreateEntryRequest["lines"];
  }): void {
    const isOpening =
      params.entryType === "OPENING" || params.journalCode === "RAN";

    if (!isOpening) {
      return;
    }

    if (params.journalCode !== "RAN") {
      throw new AppError(400, "ERROR_OPENING_ENTRY_JOURNAL_REQUIRED");
    }

    if (params.entryDate !== params.fiscalYear.startDate) {
      throw new AppError(400, "ERROR_OPENING_ENTRY_DATE_MISMATCH");
    }

    const hasNonBalanceSheetAccount = params.lines.some((line) => {
      const normalizedAccount = LedgerService.formatAccount(line.accountId);
      return !/^[1-5]/.test(normalizedAccount);
    });

    if (hasNonBalanceSheetAccount) {
      throw new AppError(400, "ERROR_OPENING_ENTRY_INVALID_ACCOUNT_CLASS");
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

    const foundBusinessIds = new Set(
      foundItems.map((item) => {
        const data = unmarshall(item);
        const sk = data.SK || item.SK?.S;
        if (typeof sk === "string" && sk.startsWith("ACC#")) {
          return sk.slice("ACC#".length);
        }
        if (typeof sk === "string" && sk.startsWith("PRJ#")) {
          return sk.slice("PRJ#".length);
        }
        return (
          data.accountId ||
          data.projectId ||
          item.accountId?.S ||
          item.projectId?.S
        );
      }),
    );

    if (
      !accountIds.every((id) => foundBusinessIds.has(id)) ||
      !projectIds.every((id) => foundBusinessIds.has(id))
    ) {
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

  static toAccountDto(account: Account): AccountDto {
    return AccountDtoSchema.parse({
      orgId: account.orgId,
      accountId: account.accountId,
      accountName: account.accountName,
      accountNature: account.accountNature,
      accountUsage: account.accountUsage,
      isThirdPartyAccount: account.isThirdPartyAccount,
      classCode: account.classCode,
      financialStatementCode: account.financialStatementCode,
      allowReconciliation: account.allowReconciliation,
      isActive: account.isActive,
      createdAt: account.createdAt,
      updatedAt: account.updatedAt,
    });
  }

  static async updateAccount(
    orgId: string,
    accountId: string,
    updates: Partial<Omit<AccountDto, "orgId" | "accountId" | "createdAt" | "updatedAt">>,
  ): Promise<Account> {
    const updatedAt = new Date().toISOString();
    const setExpressions: string[] = ["updatedAt = :updatedAt"];
    const expressionAttributeValues: Record<string, unknown> = {
      ":updatedAt": updatedAt,
    };

    for (const [field, value] of Object.entries(updates)) {
      if (typeof value === "undefined") {
        continue;
      }

      setExpressions.push(`#${field} = :${field}`);
      expressionAttributeValues[`:${field}`] = value;
    }

    try {
      const expressionAttributeNames = Object.fromEntries(
        setExpressions
          .map((expression) => expression.match(/^#([A-Za-z0-9_]+) = /)?.[1])
          .filter((field): field is string => !!field)
          .map((field) => [`#${field}`, field]),
      );

      const result = await dynamoClient.send(
        new UpdateItemCommand({
          TableName: config.TABLE_NAME,
          Key: marshall({
            PK: KeyFactory.orgKey(orgId),
            SK: KeyFactory.accountSK(accountId),
          }),
          ConditionExpression: "attribute_exists(PK) AND attribute_exists(SK)",
          UpdateExpression: `SET ${setExpressions.join(", ")}`,
          ...(Object.keys(expressionAttributeNames).length > 0
            ? { ExpressionAttributeNames: expressionAttributeNames }
            : {}),
          ExpressionAttributeValues: marshall(expressionAttributeValues),
          ReturnValues: "ALL_NEW",
        }),
      );

      return AccountSchema.parse(unmarshall(result.Attributes ?? {}));
    } catch (error: any) {
      if (error?.name === "ConditionalCheckFailedException") {
        throw new AppError(404, "ERROR_ACCOUNT_NOT_FOUND");
      }
      throw error;
    }
  }

  static async disableAccount(orgId: string, accountId: string): Promise<Account> {
    return LedgerService.updateAccount(orgId, accountId, { isActive: false });
  }

  static async listAccounts(
    orgId: string,
    options?: ListAccountsOptions,
  ): Promise<ListAccountsResult> {
    const { limit = 100, cursor } = options || {};
    const exclusiveStartKey = LedgerService.decodeCursor(cursor);

    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: config.TABLE_NAME,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
        ExpressionAttributeValues: marshall({
          ":pk": KeyFactory.orgKey(orgId),
          ":sk": KeyFactory.accountPrefix(),
        }),
        Limit: limit,
        ExclusiveStartKey: exclusiveStartKey,
        ScanIndexForward: true,
      }),
    );

    const accounts = (result.Items || [])
      .map((item) => AccountSchema.parse(unmarshall(item)))
      .map((account) => LedgerService.toAccountDto(account));

    const nextCursor = LedgerService.encodeCursor(result.LastEvaluatedKey);

    return {
      accounts,
      nextCursor,
      hasMore: !!nextCursor,
    };
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

  static async listEntries(
    orgId: string,
    options: ListEntriesOptions,
  ): Promise<ListEntriesResult> {
    const { year, journalCode, month, limit = 50, cursor } = options;
    const exclusiveStartKey = LedgerService.decodeCursor(cursor);
    let keyConditionExpression = "GSI5PK = :pk";
    const expressionAttributeValues: Record<string, string> = {
      ":pk": KeyFactory.gsi5JournalPK(orgId, year),
    };

    if (journalCode) {
      let prefix = `JNL#${journalCode.toUpperCase()}`;
      if (month) {
        prefix += `#DT#${year}-${month}`;
      }

      keyConditionExpression += " AND begins_with(GSI5SK, :sk)";
      expressionAttributeValues[":sk"] = prefix;
    }

    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: config.TABLE_NAME,
        IndexName: config.GSI5,
        KeyConditionExpression: keyConditionExpression,
        ExpressionAttributeValues: marshall(expressionAttributeValues),
        Limit: limit,
        ExclusiveStartKey: exclusiveStartKey,
        ScanIndexForward: true,
      }),
    );

    const entries = (result.Items || []).map((item) => {
      const data = unmarshall(item);
      return EntrySummaryDtoSchema.parse({
        entryId: data.entryId,
        year: data.year,
        entryDate: data.entryDate,
        journalCode: data.journalCode,
        voucherNumber: data.voucherNumber,
        label: data.label,
        totalDebit: data.totalDebit || 0,
        totalCredit: data.totalCredit || 0,
        status: data.status,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
      });
    });

    const nextCursor = LedgerService.encodeCursor(result.LastEvaluatedKey);

    return {
      entries,
      nextCursor,
      hasMore: !!nextCursor,
    };
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
        label: data.label,
        entryDate: data.entryDate,
        lineId: data.lineId,
        voucherNumber: data.voucherNumber,
        journalCode: data.journalCode,
        thirdPartyId: data.thirdPartyId,
        projectId: data.projectId,
        letteringCode: data.letteringCode,
        letteringStatus: data.letteringStatus,
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

    const balances = await BalanceService.getTrialBalance(orgId, year);
    let totalExpenses = 0;
    let totalRevenue = 0;

    for (const balance of balances) {
      const netBalance =
        balance.openingDebit +
        balance.movementDebit -
        (balance.openingCredit + balance.movementCredit);

      if (balance.accountId.startsWith("6")) {
        totalExpenses += netBalance;
      }

      if (balance.accountId.startsWith("7")) {
        totalRevenue += -netBalance;
      }
    }

    const netResult = totalRevenue - totalExpenses;

    return {
      fiscalYear: year.toString(),
      totalRevenue,
      totalExpenses,
      netResult,
      performanceStatus: netResult >= 0 ? "PROFIT" : "LOSS",
      statementBasis: "BACKEND_V1_CLASS_6_7_AGGREGATE",
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

  private static decodeCursor(cursor?: string): Record<string, any> | undefined {
    if (!cursor) {
      return undefined;
    }

    try {
      return JSON.parse(Buffer.from(cursor, "base64").toString());
    } catch {
      throw new AppError(400, "ERROR_INVALID_CURSOR");
    }
  }

  private static encodeCursor(key?: Record<string, any>): string | undefined {
    return key ? Buffer.from(JSON.stringify(key)).toString("base64") : undefined;
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
      updatedBy: userId,
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
