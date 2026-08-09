import { Account, AccountDto, AccountDtoSchema, AccountSchema } from "@liass-ohada/shared/accounting";
import {
  CreateEntryDraftRequest,
  CreateEntryRequest,
  CreateEntryRequestSchema,
  Entry,
  EntryDetailDto,
  EntryDetailDtoSchema,
  EntryLine,
  EntryLineDto,
  EntryLineDtoSchema,
  EntrySummaryDto,
  EntrySummaryDtoSchema,
  GeneralLedgerDto,
  GeneralLedgerDtoSchema,
  GeneralLedgerLineDtoSchema,
  GeneralLedgerQuery,
  EntryLineSchema,
  EntrySchema,
  UpdateEntryDraftRequest,
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
import { JournalService } from "./journal-service";
import {
  AuxiliaryAccountingService,
  ValidatedPostingLine,
} from "./auxiliary-accounting-service";
import {
  defaultAuxiliaryMetadata,
  resolveAuxiliaryMetadata,
} from "../account-auxiliary";
import {
  AccountingTreasuryPostingIdempotencyRepository,
  type TreasuryPostingIdempotencyIdentity,
} from "@/lambda/domains/accounting/posting/accounting-treasury-posting-idempotency-repository";
import { ProjectAccountingReferenceService } from "@/lambda/domains/projects/references/project-accounting-reference-service";

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
  search?: string;
  classCode?: number;
  active?: boolean;
  activeOnly?: boolean;
}

export interface ListAccountsResult {
  accounts: AccountDto[];
  nextCursor?: string;
  hasMore: boolean;
}

export interface ListEntriesOptions {
  year: string;
  journalCode?: string;
  status?: string;
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

export interface PostEntryParams {
  orgId: string;
  userId: string;
  data: CreateEntryRequest;
  treasuryPostingIdempotency?: TreasuryPostingIdempotencyIdentity;
}

export interface DraftEntryParams {
  orgId: string;
  userId: string;
  data: CreateEntryDraftRequest;
}

export interface UpdateDraftEntryParams {
  orgId: string;
  userId: string;
  data: UpdateEntryDraftRequest;
}

const SYSTEM_JOURNAL_CODES = new Set(["RAN", "OD", "CLOSING"]);

/**
 * Service handling Accounting operations and validations.
 */
export class LedgerService {
  /**
   * Posts a balanced accounting entry and its lines in one atomic transaction.
   */
  static async postEntry({
    orgId,
    userId,
    data,
    treasuryPostingIdempotency,
  }: PostEntryParams) {
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

    const projectIds = [
      ...new Set(
        lines
          .map((line) => line.projectId)
          .filter((projectId): projectId is string => !!projectId),
      ),
    ];

    await ProjectAccountingReferenceService.validateAccountingReferences({
      orgId,
      projectIds,
    });
    const validatedLines =
      await AuxiliaryAccountingService.validateAndEnrichLines(orgId, lines);

    let totalDebit = 0;
    let totalCredit = 0;
    const transactItems: any[] = [];
    const lineIds: string[] = [];

    for (let index = 0; index < validatedLines.length; index++) {
      const line = validatedLines[index];
      const paddedAccountId = LedgerService.formatAccount(line.accountId);
      const lineId = `${entryId}#L${index + 1}-${randomUUID()}`;
      const postingOrdinal = index + 1;
      lineIds.push(lineId);

      await ProjectAccountingReferenceService.validatePostingLine({
        orgId,
        year,
        projectId: line.projectId,
        budgetLineId: line.budgetLineId,
        donorId: line.donorId,
        debit: line.debit,
        credit: line.credit,
      });

      const lineItem = LedgerService.buildEntryLineItem({
        orgId,
        year,
        entryId,
        lineId,
        entryDate,
        line,
        postingOrdinal,
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
          entryDate,
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
      lineIds,
      entityType: "ENTRY",
      PK: KeyFactory.partitionKey(orgId, year),
      SK: KeyFactory.entrySK(entryId),
      GSI5PK: KeyFactory.gsi5JournalPK(orgId, year),
      GSI5SK: KeyFactory.gsi5JournalSK(
        normalizedJournalCode,
        entryDate,
        entryId,
      ),
      GSI7PK: KeyFactory.journalBookPK(orgId, year),
      GSI7SK: KeyFactory.journalBookSK(entryDate, entryId),
      createdBy: userId,
      createdAt: now,
      updatedBy: userId,
      updatedAt: now,
      postedBy: userId,
      postedAt: now,
      sourceType: treasuryPostingIdempotency ? "TREASURY" : undefined,
      sourceId: treasuryPostingIdempotency?.clientRequestId,
      sourceFingerprint: treasuryPostingIdempotency?.requestFingerprint,
    };

    if (treasuryPostingIdempotency) {
      transactItems.unshift(
        AccountingTreasuryPostingIdempotencyRepository.buildCompletedPut({
          orgId,
          userId,
          identity: treasuryPostingIdempotency,
          entryId,
          now,
        }),
      );
    }

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
        if (data.entryId) {
          const existing = await LedgerService.getEntryHeader(
            orgId,
            year,
            entryId,
          ).catch(() => undefined);
          if (
            existing?.status === "POSTED" &&
            existing.entryDate === entryDate &&
            existing.journalCode === normalizedJournalCode &&
            existing.totalDebit === totalDebit &&
            existing.totalCredit === totalCredit
          ) {
            return { entryId };
          }
        }
        throw new AppError(409, "ERROR_ENTRY_ALREADY_EXISTS", { entryId });
      }
      throw error;
    }

    return { entryId };
  }

  static async createDraftEntry({ orgId, userId, data }: DraftEntryParams): Promise<EntryDetailDto> {
    const now = new Date().toISOString();
    const entryId = `E-${randomUUID()}`;
    const normalizedJournalCode = (data.journalCode || "MISC").toUpperCase();

    const fiscalYear = await LedgerService.validateFiscalYear(orgId, data.year);
    LedgerService.assertEntryDateInFiscalYear(data.entryDate, fiscalYear);

    const lineIds: string[] = [];
    const transactItems: any[] = [];
    let totalDebit = 0;
    let totalCredit = 0;

    for (let index = 0; index < data.lines.length; index++) {
      const line = data.lines[index];
      const lineId = `${entryId}#L${index + 1}-${randomUUID()}`;
      lineIds.push(lineId);
      totalDebit += Math.round(line.debit || 0);
      totalCredit += Math.round(line.credit || 0);

      const lineItem = LedgerService.buildDraftEntryLineItem({
        orgId,
        year: data.year,
        entryId,
        lineId,
        entryDate: data.entryDate,
        line,
        postingOrdinal: index + 1,
        paddedAccountId: LedgerService.formatAccount(line.accountId),
        journalCode: normalizedJournalCode,
        voucherNumber: data.voucherNumber,
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
    }

    const entryHeader = EntrySchema.parse({
      orgId,
      year: data.year,
      entryId,
      entryType: data.entryType || "STANDARD",
      entryDate: data.entryDate,
      journalCode: normalizedJournalCode,
      voucherNumber: data.voucherNumber,
      totalDebit,
      totalCredit,
      label: data.label,
      status: "DRAFT",
      lineIds,
      entityType: "ENTRY",
      PK: KeyFactory.partitionKey(orgId, data.year),
      SK: KeyFactory.entrySK(entryId),
      GSI5PK: KeyFactory.gsi5JournalPK(orgId, data.year),
      GSI5SK: KeyFactory.gsi5JournalSK(
        normalizedJournalCode,
        data.entryDate,
        entryId,
      ),
      createdBy: userId,
      createdAt: now,
      updatedBy: userId,
      updatedAt: now,
    });

    transactItems.unshift({
      Put: {
        TableName: config.TABLE_NAME,
        Item: marshall(entryHeader, { removeUndefinedValues: true }),
        ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
      },
    });

    await dynamoClient.send(
      new TransactWriteItemsCommand({ TransactItems: transactItems }),
    );

    return LedgerService.toEntryDetailDto(entryHeader, await LedgerService.queryEntryLines(orgId, data.year, entryId));
  }

  static async updateDraftEntry({ orgId, userId, data }: UpdateDraftEntryParams): Promise<EntryDetailDto> {
    const existing = await LedgerService.getEntryHeader(orgId, data.year, data.entryId);

    if (existing.status !== "DRAFT") {
      throw new AppError(400, "ERROR_ENTRY_DRAFT_NOT_EDITABLE");
    }

    const fiscalYear = await LedgerService.validateFiscalYear(orgId, data.year);
    LedgerService.assertEntryDateInFiscalYear(data.entryDate, fiscalYear);

    const now = new Date().toISOString();
    const normalizedJournalCode = (data.journalCode || "MISC").toUpperCase();
    const existingLines = await LedgerService.queryEntryLines(orgId, data.year, data.entryId);
    const lineIds: string[] = [];
    const transactItems: any[] = [];
    let totalDebit = 0;
    let totalCredit = 0;

    for (const line of existingLines) {
      transactItems.push({
        Delete: {
          TableName: config.TABLE_NAME,
          Key: marshall({
            PK: KeyFactory.partitionKey(orgId, data.year),
            SK: KeyFactory.entryLineSK(line.lineId),
          }),
          ConditionExpression: "attribute_exists(PK) AND attribute_exists(SK)",
        },
      });
    }

    for (let index = 0; index < data.lines.length; index++) {
      const line = data.lines[index];
      const lineId = `${data.entryId}#L${index + 1}-${randomUUID()}`;
      lineIds.push(lineId);
      totalDebit += Math.round(line.debit || 0);
      totalCredit += Math.round(line.credit || 0);

      const lineItem = LedgerService.buildDraftEntryLineItem({
        orgId,
        year: data.year,
        entryId: data.entryId,
        lineId,
        entryDate: data.entryDate,
        line,
        postingOrdinal: index + 1,
        paddedAccountId: LedgerService.formatAccount(line.accountId),
        journalCode: normalizedJournalCode,
        voucherNumber: data.voucherNumber,
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
    }

    const updateExpressions = [
      "entryDate = :entryDate",
      "journalCode = :journalCode",
      "entryType = :entryType",
      "totalDebit = :totalDebit",
      "totalCredit = :totalCredit",
      "lineIds = :lineIds",
      "GSI5SK = :gsi5sk",
      "updatedBy = :updatedBy",
      "updatedAt = :updatedAt",
    ];
    const removeExpressions: string[] = [];
    const expressionAttributeNames: Record<string, string> = {
      "#status": "status",
    };
    const expressionAttributeValues: Record<string, unknown> = {
      ":draft": "DRAFT",
      ":entryDate": data.entryDate,
      ":journalCode": normalizedJournalCode,
      ":entryType": data.entryType || "STANDARD",
      ":totalDebit": totalDebit,
      ":totalCredit": totalCredit,
      ":lineIds": lineIds,
      ":gsi5sk": KeyFactory.gsi5JournalSK(
        normalizedJournalCode,
        data.entryDate,
        data.entryId,
      ),
      ":updatedBy": userId,
      ":updatedAt": now,
    };

    if (data.voucherNumber) {
      updateExpressions.push("voucherNumber = :voucherNumber");
      expressionAttributeValues[":voucherNumber"] = data.voucherNumber;
    } else {
      removeExpressions.push("voucherNumber");
    }

    if (data.label) {
      updateExpressions.push("#label = :label");
      expressionAttributeNames["#label"] = "label";
      expressionAttributeValues[":label"] = data.label;
    } else {
      expressionAttributeNames["#label"] = "label";
      removeExpressions.push("#label");
    }

    transactItems.unshift({
      Update: {
        TableName: config.TABLE_NAME,
        Key: marshall({
          PK: KeyFactory.partitionKey(orgId, data.year),
          SK: KeyFactory.entrySK(data.entryId),
        }),
        ConditionExpression: "#status = :draft",
        UpdateExpression: [
          `SET ${updateExpressions.join(", ")}`,
          removeExpressions.length ? `REMOVE ${removeExpressions.join(", ")}` : "",
        ].filter(Boolean).join(" "),
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: marshall(expressionAttributeValues),
      },
    });

    await dynamoClient.send(
      new TransactWriteItemsCommand({ TransactItems: transactItems }),
    );

    return LedgerService.getEntryDetail(orgId, data.year, data.entryId);
  }

  static async deleteDraftEntry(orgId: string, year: number, entryId: string): Promise<{ entryId: string }> {
    const existing = await LedgerService.getEntryHeader(orgId, year, entryId);

    if (existing.status !== "DRAFT") {
      throw new AppError(400, "ERROR_ENTRY_DRAFT_NOT_EDITABLE");
    }

    const lines = await LedgerService.queryEntryLines(orgId, year, entryId);
    const transactItems: any[] = [
      {
        Delete: {
          TableName: config.TABLE_NAME,
          Key: marshall({
            PK: KeyFactory.partitionKey(orgId, year),
            SK: KeyFactory.entrySK(entryId),
          }),
          ConditionExpression: "#status = :draft",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: marshall({ ":draft": "DRAFT" }),
        },
      },
    ];

    for (const line of lines) {
      transactItems.push({
        Delete: {
          TableName: config.TABLE_NAME,
          Key: marshall({
            PK: KeyFactory.partitionKey(orgId, year),
            SK: KeyFactory.entryLineSK(line.lineId),
          }),
        },
      });
    }

    await dynamoClient.send(
      new TransactWriteItemsCommand({ TransactItems: transactItems }),
    );

    return { entryId };
  }

  static async postDraftEntry(orgId: string, userId: string, year: number, entryId: string): Promise<{ entryId: string }> {
    const draft = await LedgerService.getEntryHeader(orgId, year, entryId);

    if (draft.status === "POSTED") {
      return { entryId };
    }

    if (draft.status !== "DRAFT") {
      throw new AppError(400, "ERROR_ENTRY_DRAFT_NOT_EDITABLE");
    }

    const draftLines = await LedgerService.queryEntryLines(orgId, year, entryId);
    const data = CreateEntryRequestSchema.parse({
      year: draft.year,
      entryDate: draft.entryDate,
      journalCode: draft.journalCode,
      voucherNumber: draft.voucherNumber,
      entryId: draft.entryId,
      entryType: draft.entryType,
      label: draft.label || draft.entryId,
      lines: draftLines.map((line) => ({
        accountId: line.accountId,
        projectId: line.projectId,
        budgetLineId: line.budgetLineId,
        thirdPartyId: line.thirdPartyId,
        thirdPartyType: line.thirdPartyType,
        donorId: line.donorId,
        debit: line.debit,
        credit: line.credit,
        description: line.description,
        label: line.label,
      })),
    });

    const fiscalYear = await LedgerService.validateFiscalYear(orgId, data.year);
    LedgerService.assertEntryDateInFiscalYear(data.entryDate, fiscalYear);
    LedgerService.validateOpeningEntryRules({
      entryType: data.entryType,
      entryDate: data.entryDate,
      fiscalYear,
      journalCode: data.journalCode.toUpperCase(),
      lines: data.lines,
    });
    await LedgerService.validateJournalForPosting(orgId, data.journalCode);

    if (await LedgerService.isPeriodLocked(orgId, data.entryDate)) {
      throw new AppError(400, "ERROR_PERIOD_LOCKED");
    }

    const projectIds = [
      ...new Set(
        data.lines
          .map((line) => line.projectId)
          .filter((projectId): projectId is string => !!projectId),
      ),
    ];

    await ProjectAccountingReferenceService.validateAccountingReferences({
      orgId,
      projectIds,
    });
    const validatedLines =
      await AuxiliaryAccountingService.validateAndEnrichLines(
        orgId,
        data.lines,
      );

    const totalDebit = data.lines.reduce((sum, line) => sum + Math.round(line.debit || 0), 0);
    const totalCredit = data.lines.reduce((sum, line) => sum + Math.round(line.credit || 0), 0);

    if (totalDebit !== totalCredit) {
      throw new AppError(400, "ERROR_ENTRY_NOT_BALANCED");
    }

    const now = new Date().toISOString();
    const normalizedJournalCode = data.journalCode.toUpperCase();
    const transactItems: any[] = [
      {
        Update: {
          TableName: config.TABLE_NAME,
          Key: marshall({
            PK: KeyFactory.partitionKey(orgId, year),
            SK: KeyFactory.entrySK(entryId),
          }),
          ConditionExpression: "#status = :draft",
          UpdateExpression:
            "SET #status = :posted, totalDebit = :totalDebit, totalCredit = :totalCredit, GSI7PK = :gsi7pk, GSI7SK = :gsi7sk, updatedBy = :updatedBy, updatedAt = :updatedAt, postedBy = :postedBy, postedAt = :postedAt",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: marshall({
            ":draft": "DRAFT",
            ":posted": "POSTED",
            ":totalDebit": totalDebit,
            ":totalCredit": totalCredit,
            ":gsi7pk": KeyFactory.journalBookPK(orgId, year),
            ":gsi7sk": KeyFactory.journalBookSK(data.entryDate, entryId),
            ":updatedBy": userId,
            ":updatedAt": now,
            ":postedBy": userId,
            ":postedAt": now,
          }),
        },
      },
    ];

    for (let index = 0; index < validatedLines.length; index++) {
      const line = validatedLines[index];
      const draftLine = draftLines[index];
      const paddedAccountId = LedgerService.formatAccount(line.accountId);
      const postingOrdinal = draftLine.postingOrdinal ?? index + 1;

      await ProjectAccountingReferenceService.validatePostingLine({
        orgId,
        year,
        projectId: line.projectId,
        budgetLineId: line.budgetLineId,
        donorId: line.donorId,
        debit: line.debit,
        credit: line.credit,
      });

      const lineItem = LedgerService.buildEntryLineItem({
        orgId,
        year,
        entryId,
        lineId: draftLine.lineId,
        entryDate: data.entryDate,
        line,
        postingOrdinal,
        paddedAccountId,
        journalCode: normalizedJournalCode,
        voucherNumber: data.voucherNumber,
        userId,
        now,
      });

      transactItems.push({
        Put: {
          TableName: config.TABLE_NAME,
          Item: marshall(EntryLineSchema.parse(lineItem), {
            removeUndefinedValues: true,
          }),
          ConditionExpression: "attribute_exists(PK) AND attribute_exists(SK)",
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
          data.entryDate,
        ),
      );
    }

    await dynamoClient.send(
      new TransactWriteItemsCommand({ TransactItems: transactItems }),
    );

    return { entryId };
  }

  static async getEntryDetail(orgId: string, year: number, entryId: string): Promise<EntryDetailDto> {
    const entry = await LedgerService.getEntryHeader(orgId, year, entryId);
    const lines = await LedgerService.queryEntryLines(orgId, year, entryId);

    return LedgerService.toEntryDetailDto(entry, lines);
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
    const auxiliaryMetadata = resolveAuxiliaryMetadata(account);
    return AccountDtoSchema.parse({
      orgId: account.orgId,
      accountId: account.accountId,
      accountName: account.accountName,
      accountNature: account.accountNature,
      accountUsage: account.accountUsage,
      isThirdPartyAccount: account.isThirdPartyAccount,
      ...auxiliaryMetadata,
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
    const updatesWithAuxiliaryMetadata = { ...updates };
    const touchesAuxiliaryConfiguration =
      updates.isThirdPartyAccount !== undefined ||
      updates.requiresThirdParty !== undefined ||
      updates.auxiliaryType !== undefined;
    if (touchesAuxiliaryConfiguration) {
      const current = await LedgerService.getAccount(orgId, accountId);
      const explicitPair =
        updates.requiresThirdParty !== undefined ||
        updates.auxiliaryType !== undefined;
      const metadata = explicitPair
        ? resolveAuxiliaryMetadata({ ...current, ...updates })
        : defaultAuxiliaryMetadata(
            accountId,
            updates.isThirdPartyAccount ?? current.isThirdPartyAccount,
          );
      updatesWithAuxiliaryMetadata.isThirdPartyAccount =
        metadata.auxiliaryType !== "NONE";
      updatesWithAuxiliaryMetadata.requiresThirdParty =
        metadata.requiresThirdParty;
      updatesWithAuxiliaryMetadata.auxiliaryType = metadata.auxiliaryType;
    }

    const updatedAt = new Date().toISOString();
    const setExpressions: string[] = ["updatedAt = :updatedAt"];
    const expressionAttributeValues: Record<string, unknown> = {
      ":updatedAt": updatedAt,
    };

    for (const [field, value] of Object.entries(updatesWithAuxiliaryMetadata)) {
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
    const {
      limit = 100,
      cursor,
      search,
      classCode,
      active,
      activeOnly = false,
    } = options || {};
    const normalizedSearch = search?.trim();

    if (
      normalizedSearch &&
      classCode &&
      normalizedSearch.charAt(0) !== String(classCode)
    ) {
      return {
        accounts: [],
        hasMore: false,
      };
    }

    const exclusiveStartKey = LedgerService.decodeCursor(cursor);
    const accountPrefix =
      normalizedSearch ?? (classCode ? String(classCode) : "");
    const activeFilter = active ?? (activeOnly ? true : undefined);

    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: config.TABLE_NAME,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
        ExpressionAttributeValues: marshall({
          ":pk": KeyFactory.orgKey(orgId),
          ":sk": `${KeyFactory.accountPrefix()}${accountPrefix}`,
          ...(activeFilter !== undefined ? { ":active": activeFilter } : {}),
        }),
        ...(activeFilter !== undefined
          ? {
              ExpressionAttributeNames: {
                "#isActive": "isActive",
              },
              FilterExpression: activeFilter
                ? "attribute_not_exists(#isActive) OR #isActive = :active"
                : "#isActive = :active",
            }
          : {}),
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
    const { year, journalCode, status, month, limit = 50, cursor } = options;
    const exclusiveStartKey = LedgerService.decodeCursor(cursor);
    let keyConditionExpression = "GSI5PK = :pk";
    const expressionAttributeValues: Record<string, string> = {
      ":pk": KeyFactory.gsi5JournalPK(orgId, year),
    };
    const expressionAttributeNames: Record<string, string> = {};
    let filterExpression: string | undefined;

    if (journalCode) {
      let prefix = `JNL#${journalCode.toUpperCase()}`;
      if (month) {
        prefix += `#DT#${year}-${month}`;
      }

      keyConditionExpression += " AND begins_with(GSI5SK, :sk)";
      expressionAttributeValues[":sk"] = prefix;
    }

    if (status) {
      expressionAttributeNames["#status"] = "status";
      expressionAttributeValues[":status"] = status;
      filterExpression = "#status = :status";
    }

    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: config.TABLE_NAME,
        IndexName: config.GSI5,
        KeyConditionExpression: keyConditionExpression,
        ...(filterExpression ? { FilterExpression: filterExpression } : {}),
        ...(Object.keys(expressionAttributeNames).length > 0
          ? { ExpressionAttributeNames: expressionAttributeNames }
          : {}),
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
        thirdPartyType: data.thirdPartyType,
        thirdPartyCode: data.thirdPartyCode,
        thirdPartyName: data.thirdPartyName,
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
    input: GeneralLedgerQuery,
  ): Promise<GeneralLedgerDto> {
    const { fiscalYear, accountId, limit = 50, cursor } = input;
    const hasPeriodFilter = !!input.startDate || !!input.endDate;
    const fiscalYearRecord = hasPeriodFilter
      ? await LedgerService.getFiscalYear(orgId, fiscalYear)
      : null;
    const startDate =
      input.startDate ?? fiscalYearRecord?.startDate ?? `${fiscalYear}-01-01`;
    const endDate =
      input.endDate ?? fiscalYearRecord?.endDate ?? `${fiscalYear}-12-31`;

    if (
      fiscalYearRecord &&
      (startDate < fiscalYearRecord.startDate || endDate > fiscalYearRecord.endDate)
    ) {
      throw new AppError(400, "ERROR_TRIAL_BALANCE_DATE_OUTSIDE_FISCAL_YEAR");
    }

    const paddedAccountId = LedgerService.formatAccount(accountId);
    const accountBalance = await BalanceService.getAccountBalance(
      orgId,
      fiscalYear,
      paddedAccountId,
    );

    const isFullFiscalYear =
      !hasPeriodFilter ||
      (startDate === fiscalYearRecord?.startDate &&
        endDate === fiscalYearRecord?.endDate);
    if (!isFullFiscalYear) {
      BalanceService.assertPeriodDetailComplete(accountBalance);
    }

    let openingNet = accountBalance.openingDebit - accountBalance.openingCredit;
    let selectedMovementNet = 0;
    if (isFullFiscalYear) {
      selectedMovementNet =
        accountBalance.movementDebit - accountBalance.movementCredit;
    } else {
      for (const [date, movement] of Object.entries(
        accountBalance.dailyMovements,
      )) {
        if (date < startDate) {
          openingNet += movement.debit - movement.credit;
        } else if (date <= endDate) {
          selectedMovementNet += movement.debit - movement.credit;
        }
      }
    }

    const continuation = LedgerService.decodeGeneralLedgerCursor(cursor);
    let exclusiveStartKey = continuation?.key;
    let runningBalance = continuation?.runningBalance ?? openingNet;
    let lastEvaluatedKey: Record<string, any> | undefined;
    const movements: GeneralLedgerDto["movements"] = [];

    do {
      const queryResult = await dynamoClient.send(
        new QueryCommand({
          TableName: config.TABLE_NAME,
          IndexName: config.GSI1,
          KeyConditionExpression:
            "GSI1PK = :gsi1pk AND GSI1SK BETWEEN :from AND :to",
          ExpressionAttributeValues: marshall({
            ":gsi1pk": KeyFactory.gsi1PK(orgId),
            ":from": `${KeyFactory.gsi1SKPrefix(
              paddedAccountId,
              fiscalYear,
            )}#DT#${startDate}#`,
            ":to": `${KeyFactory.gsi1SKPrefix(
              paddedAccountId,
              fiscalYear,
            )}#DT#${endDate}#\uffff`,
          }),
          Limit: Math.max(limit - movements.length, 1),
          ExclusiveStartKey: exclusiveStartKey,
          ScanIndexForward: true,
        }),
      );

      for (const item of queryResult.Items || []) {
        const line = unmarshall(item);
        if (line.journalCode === "RAN") {
          continue;
        }

        const debit = Number(line.debit) || 0;
        const credit = Number(line.credit) || 0;
        runningBalance += debit - credit;
        movements.push(
          GeneralLedgerLineDtoSchema.parse({
            date: line.entryDate,
            label: line.label || line.description || "-",
            reference: line.voucherNumber || line.entryId,
            journalCode: line.journalCode,
            journal: line.journalCode,
            entryId: line.entryId,
            lineId: line.lineId,
            debit,
            credit,
            runningBalance,
          }),
        );
      }

      lastEvaluatedKey = queryResult.LastEvaluatedKey;
      exclusiveStartKey = lastEvaluatedKey;
    } while (movements.length < limit && lastEvaluatedKey);

    const nextCursor = lastEvaluatedKey
      ? LedgerService.encodeGeneralLedgerCursor({
          key: lastEvaluatedKey,
          runningBalance,
        })
      : undefined;
    const finalBalance = openingNet + selectedMovementNet;

    return GeneralLedgerDtoSchema.parse({
      accountId: paddedAccountId,
      openingBalance: {
        debit: accountBalance.openingDebit,
        credit: accountBalance.openingCredit,
        balance: openingNet,
      },
      movements,
      finalBalance,
      nextCursor,
      hasMore: !!nextCursor,
    });
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

  private static async getEntryHeader(
    orgId: string,
    year: number,
    entryId: string,
  ): Promise<Entry> {
    const result = await dynamoClient.send(
      new GetItemCommand({
        TableName: config.TABLE_NAME,
        Key: marshall({
          PK: KeyFactory.partitionKey(orgId, year),
          SK: KeyFactory.entrySK(entryId),
        }),
      }),
    );

    if (!result.Item) {
      throw new AppError(404, "ERROR_ENTRY_NOT_FOUND");
    }

    return EntrySchema.parse(unmarshall(result.Item));
  }

  private static async queryEntryLines(
    orgId: string,
    year: number,
    entryId: string,
  ): Promise<EntryLine[]> {
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: config.TABLE_NAME,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
        ExpressionAttributeValues: marshall({
          ":pk": KeyFactory.partitionKey(orgId, year),
          ":sk": KeyFactory.entryLineSK(`${entryId}#`),
        }),
        ScanIndexForward: true,
      }),
    );

    return (result.Items || [])
      .map((item) => EntryLineSchema.parse(unmarshall(item)))
      .sort(
        (left, right) =>
          (left.postingOrdinal ?? Number.MAX_SAFE_INTEGER) -
            (right.postingOrdinal ?? Number.MAX_SAFE_INTEGER) ||
          left.lineId.localeCompare(right.lineId),
      );
  }

  private static async toEntryDetailDto(
    entry: Entry,
    lines: EntryLine[],
  ): Promise<EntryDetailDto> {
    const accountNames = await LedgerService.getAccountNames(
      entry.orgId,
      lines.map((line) => line.accountId),
    );

    return EntryDetailDtoSchema.parse({
      entryId: entry.entryId,
      year: entry.year,
      entryDate: entry.entryDate,
      journalCode: entry.journalCode,
      voucherNumber: entry.voucherNumber,
      entryType: entry.entryType,
      label: entry.label,
      totalDebit: entry.totalDebit,
      totalCredit: entry.totalCredit,
      status: entry.status,
      createdBy: entry.createdBy,
      createdAt: entry.createdAt,
      updatedBy: entry.updatedBy,
      updatedAt: entry.updatedAt,
      postedBy: entry.postedBy,
      postedAt: entry.postedAt,
      lines: lines.map((line) => LedgerService.toEntryLineDto(line, accountNames)),
    });
  }

  private static toEntryLineDto(
    line: EntryLine,
    accountNames: Map<string, string>,
  ): EntryLineDto {
    return EntryLineDtoSchema.parse({
      lineId: line.lineId,
      accountId: line.accountId,
      accountName: accountNames.get(line.accountId),
      debit: line.debit,
      credit: line.credit,
      description: line.description,
      label: line.label,
      thirdPartyId: line.thirdPartyId,
      thirdPartyType: line.thirdPartyType,
      thirdPartyCode: line.thirdPartyCode,
      thirdPartyName: line.thirdPartyName,
      projectId: line.projectId,
      budgetLineId: line.budgetLineId,
      donorId: line.donorId,
      letteringCode: line.letteringCode,
      letteringStatus: line.letteringStatus,
    });
  }

  private static async getAccountNames(
    orgId: string,
    accountIds: string[],
  ): Promise<Map<string, string>> {
    const uniqueAccountIds = [...new Set(accountIds)].filter(Boolean);

    if (uniqueAccountIds.length === 0) {
      return new Map();
    }

    const result = await dynamoClient.send(
      new BatchGetItemCommand({
        RequestItems: {
          [config.TABLE_NAME]: {
            Keys: uniqueAccountIds.map((accountId) =>
              marshall({
                PK: KeyFactory.orgKey(orgId),
                SK: KeyFactory.accountSK(accountId),
              }),
            ),
          },
        },
      }),
    );

    const names = new Map<string, string>();
    for (const item of result.Responses?.[config.TABLE_NAME] || []) {
      const account = unmarshall(item);
      if (account.accountId && account.accountName) {
        names.set(account.accountId, account.accountName);
      }
    }

    return names;
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

  private static decodeGeneralLedgerCursor(cursor?: string):
    | {
        key: Record<string, any>;
        runningBalance: number;
      }
    | undefined {
    if (!cursor) {
      return undefined;
    }

    try {
      const parsed = JSON.parse(Buffer.from(cursor, "base64").toString());
      if (
        !parsed ||
        typeof parsed !== "object" ||
        !parsed.key ||
        typeof parsed.key !== "object" ||
        !Number.isInteger(parsed.runningBalance)
      ) {
        throw new Error("Invalid cursor");
      }

      return {
        key: parsed.key,
        runningBalance: parsed.runningBalance,
      };
    } catch {
      throw new AppError(400, "ERROR_INVALID_CURSOR");
    }
  }

  private static encodeGeneralLedgerCursor(cursor: {
    key: Record<string, any>;
    runningBalance: number;
  }): string {
    return Buffer.from(JSON.stringify(cursor)).toString("base64");
  }

  private static buildEntryLineItem(params: {
    orgId: string;
    year: number;
    entryId: string;
    lineId: string;
    entryDate: string;
    line: ValidatedPostingLine;
    postingOrdinal: number;
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
      postingOrdinal,
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
      accountCode: line.accountCode,
      accountLabel: line.accountLabel,
      postingOrdinal,
      projectId: line.projectId,
      budgetLineId: line.budgetLineId,
      donorId: line.donorId,
      thirdPartyId: line.thirdPartyId,
      thirdPartyType: line.thirdPartyType,
      thirdPartyCode: line.thirdPartyCode,
      thirdPartyName: line.thirdPartyName,
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

    if (line.thirdPartyId && line.thirdPartyType) {
      // GSI2 is immutable auxiliary history; GSI3 is only the unlettered queue.
      item.GSI2PK = KeyFactory.gsi2PK(orgId, paddedAccountId, line.thirdPartyId);
      item.GSI2SK = KeyFactory.gsi2SK(entryDate, lineId);
      item.GSI3PK = KeyFactory.letteringPK(
        orgId,
        paddedAccountId,
        line.thirdPartyId,
      );
      item.GSI3SK = KeyFactory.letteringSK(
        entryDate,
        entryId,
        postingOrdinal.toString().padStart(4, "0"),
      );
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

  private static buildDraftEntryLineItem(params: {
    orgId: string;
    year: number;
    entryId: string;
    lineId: string;
    entryDate: string;
    line: CreateEntryDraftRequest["lines"][number];
    postingOrdinal: number;
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
      postingOrdinal,
      paddedAccountId,
      journalCode,
      voucherNumber,
      userId,
      now,
    } = params;

    return {
      orgId,
      year,
      lineId,
      entryId,
      entryDate,
      journalCode,
      voucherNumber,
      accountId: paddedAccountId,
      postingOrdinal,
      projectId: line.projectId,
      budgetLineId: line.budgetLineId,
      donorId: line.donorId,
      thirdPartyId: line.thirdPartyId,
      thirdPartyType: line.thirdPartyType,
      label: line.label,
      description: line.description,
      debit: Math.round(line.debit || 0),
      credit: Math.round(line.credit || 0),
      entityType: "ENTRY_LINE",
      PK: KeyFactory.partitionKey(orgId, year),
      SK: KeyFactory.entryLineSK(lineId),
      createdBy: userId,
      createdAt: now,
      updatedBy: userId,
      updatedAt: now,
    };
  }
}
