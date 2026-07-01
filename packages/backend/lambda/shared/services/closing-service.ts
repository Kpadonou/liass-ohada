import { config } from "@/lambda/shared/config";
import { dynamoClient } from "@/lambda/shared/dynamo-client";
import { KeyFactory } from "@/lambda/shared/key-builder";
import { AppError } from "@/lambda/shared/middleware/handler-wrapper";
import {
  BatchGetItemCommand,
  GetItemCommand,
  QueryCommand,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import {
  Account,
  ClosingCheckResponseDto,
  ClosingCheckResponseDtoSchema,
  ClosingIssueDto,
  Entry,
  EntryLine,
  EntryLineSchema,
  EntrySchema,
  FiscalYear,
  FiscalYearDtoSchema,
  FiscalYearSchema,
} from "@liass-ohada/shared/accounting";
import { resolveAuxiliaryMetadata } from "../account-auxiliary";
import { BalanceService } from "./balance-service";
import { JournalService } from "./journal-service";

const SYSTEM_JOURNAL_CODES = new Set(["RAN", "OD", "CLOSING"]);

export class ClosingService {
  static async runClosingChecks(
    orgId: string,
    year: string,
    options: { allowClosedFiscalYear?: boolean } = {},
  ): Promise<ClosingCheckResponseDto> {
    const fiscalYear = await ClosingService.getFiscalYear(orgId, year);
    const errors: ClosingIssueDto[] = [];
    const warnings: ClosingIssueDto[] = [];

    if (
      fiscalYear.status !== "OPEN" &&
      !(options.allowClosedFiscalYear && fiscalYear.status === "CLOSED")
    ) {
      errors.push({
        code: "FISCAL_YEAR_NOT_OPEN",
        scope: "FISCAL_YEAR",
      });
    }

    const [entries, lines, balances, journals] = await Promise.all([
      ClosingService.listEntryHeaders(orgId, year),
      ClosingService.listEntryLines(orgId, year),
      BalanceService.getTrialBalance(orgId, year),
      JournalService.listJournals(orgId),
    ]);

    const linesByEntry = ClosingService.groupLinesByEntry(lines);
    const draftEntries = entries.filter((entry) => entry.status === "DRAFT");
    const postedEntries = entries.filter((entry) => entry.status === "POSTED");
    const postedEntryIds = new Set(postedEntries.map((entry) => entry.entryId));
    const postedLines = lines.filter((line) => postedEntryIds.has(line.entryId));
    const unbalancedEntryIds = new Set<string>();

    for (const entry of entries) {
      const entryLines = linesByEntry.get(entry.entryId) ?? [];
      const lineDebit = entryLines.reduce((sum, line) => sum + line.debit, 0);
      const lineCredit = entryLines.reduce((sum, line) => sum + line.credit, 0);

      if (
        entry.totalDebit !== entry.totalCredit ||
        lineDebit !== lineCredit ||
        entry.totalDebit !== lineDebit ||
        entry.totalCredit !== lineCredit
      ) {
        unbalancedEntryIds.add(entry.entryId);
        errors.push({
          code: "ENTRY_NOT_BALANCED",
          scope: "ENTRY",
          entryId: entry.entryId,
        });
      }

      if (entry.status !== "POSTED" && (entry.GSI7PK || entry.GSI7SK)) {
        errors.push({
          code: "UNPOSTED_ENTRY_INCLUDED_IN_BOOKS",
          scope: "ENTRY",
          entryId: entry.entryId,
        });
      }
    }

    if (draftEntries.length > 0) {
      errors.push({
        code: "DRAFT_ENTRIES_REMAIN",
        scope: "ENTRY",
      });
    }

    const trialBalanceDebit = balances.reduce(
      (sum, balance) => sum + balance.openingDebit + balance.movementDebit,
      0,
    );
    const trialBalanceCredit = balances.reduce(
      (sum, balance) => sum + balance.openingCredit + balance.movementCredit,
      0,
    );

    if (trialBalanceDebit !== trialBalanceCredit) {
      errors.push({
        code: "TRIAL_BALANCE_NOT_BALANCED",
        scope: "TRIAL_BALANCE",
      });
    }

    const journalCodes = new Set(journals.map((journal) => journal.journalCode));
    for (const entry of postedEntries) {
      if (
        !SYSTEM_JOURNAL_CODES.has(entry.journalCode) &&
        !journalCodes.has(entry.journalCode)
      ) {
        errors.push({
          code: "JOURNAL_NOT_FOUND",
          scope: "JOURNAL",
          entryId: entry.entryId,
          journalCode: entry.journalCode,
        });
      }
    }

    const accounts = await ClosingService.getAccounts(
      orgId,
      postedLines.map((line) => line.accountId),
    );
    let unletteredAuxiliaryLinesCount = 0;

    for (const line of postedLines) {
      const account = accounts.get(line.accountId);
      if (!account) {
        errors.push({
          code: "ACCOUNT_NOT_FOUND",
          scope: "ACCOUNT",
          entryId: line.entryId,
          lineId: line.lineId,
          accountId: line.accountId,
        });
        continue;
      }

      if (account.isActive === false) {
        errors.push({
          code: "ACCOUNT_INACTIVE",
          scope: "ACCOUNT",
          entryId: line.entryId,
          lineId: line.lineId,
          accountId: line.accountId,
        });
      }

      const metadata = ClosingService.resolveAccountAuxiliary(account);
      if (!metadata) {
        errors.push({
          code: "ACCOUNT_AUXILIARY_CONFIGURATION_INVALID",
          scope: "ACCOUNT",
          entryId: line.entryId,
          lineId: line.lineId,
          accountId: line.accountId,
        });
        continue;
      }

      if (!metadata.requiresThirdParty) {
        continue;
      }

      if (!line.thirdPartyId || !line.thirdPartyType) {
        errors.push({
          code: "AUXILIARY_THIRD_PARTY_REQUIRED",
          scope: "AUXILIARY",
          entryId: line.entryId,
          lineId: line.lineId,
          accountId: line.accountId,
          thirdPartyId: line.thirdPartyId,
        });
        continue;
      }

      if (
        metadata.auxiliaryType !== "THIRD_PARTY" &&
        line.thirdPartyType !== metadata.auxiliaryType
      ) {
        errors.push({
          code: "AUXILIARY_THIRD_PARTY_TYPE_MISMATCH",
          scope: "AUXILIARY",
          entryId: line.entryId,
          lineId: line.lineId,
          accountId: line.accountId,
          thirdPartyId: line.thirdPartyId,
        });
      }

      if (
        (metadata.auxiliaryType === "CUSTOMER" ||
          metadata.auxiliaryType === "SUPPLIER") &&
        (line.letteringStatus === undefined ||
          line.letteringStatus === "UNLETTERED" ||
          line.letteringStatus === "PARTIAL") &&
        line.GSI3PK &&
        line.GSI3SK
      ) {
        unletteredAuxiliaryLinesCount += 1;
      }
    }

    if (unletteredAuxiliaryLinesCount > 0) {
      warnings.push({
        code: "UNLETTERED_AUXILIARY_LINES_REMAIN",
        scope: "AUXILIARY",
      });
    }

    return ClosingCheckResponseDtoSchema.parse({
      canClose: errors.length === 0,
      errors,
      warnings,
      summary: {
        fiscalYear: ClosingService.toFiscalYearDto(fiscalYear),
        draftEntriesCount: draftEntries.length,
        postedEntriesCount: postedEntries.length,
        unbalancedEntriesCount: unbalancedEntryIds.size,
        trialBalanceDebit,
        trialBalanceCredit,
        unletteredAuxiliaryLinesCount,
      },
    });
  }

  static async closeFiscalYear(params: {
    orgId: string;
    userId: string;
    year: string;
    confirmWarnings?: boolean;
  }) {
    const fiscalYear = await ClosingService.getFiscalYear(
      params.orgId,
      params.year,
    );

    if (fiscalYear.status === "CLOSED") {
      const checks = await ClosingService.runClosingChecks(
        params.orgId,
        params.year,
        { allowClosedFiscalYear: true },
      );

      return {
        fiscalYear: ClosingService.toFiscalYearDto(fiscalYear),
        checks,
      };
    }

    const checks = await ClosingService.runClosingChecks(
      params.orgId,
      params.year,
    );

    if (!checks.canClose) {
      throw new AppError(400, "ERROR_FISCAL_YEAR_CLOSE_CHECKS_FAILED", {
        errors: checks.errors,
        warnings: checks.warnings,
      });
    }

    if (checks.warnings.length > 0 && !params.confirmWarnings) {
      throw new AppError(400, "ERROR_FISCAL_YEAR_CLOSE_WARNINGS_REQUIRE_CONFIRMATION", {
        warnings: checks.warnings,
      });
    }

    const now = new Date().toISOString();

    try {
      const result = await dynamoClient.send(
        new UpdateItemCommand({
          TableName: config.TABLE_NAME,
          Key: marshall({
            PK: KeyFactory.orgKey(params.orgId),
            SK: KeyFactory.fiscalYearSK(params.year),
          }),
          ConditionExpression: "#status = :open",
          UpdateExpression:
            "SET #status = :closed, closedAt = :now, closedBy = :userId, updatedAt = :now, updatedBy = :userId",
          ExpressionAttributeNames: {
            "#status": "status",
          },
          ExpressionAttributeValues: marshall({
            ":open": "OPEN",
            ":closed": "CLOSED",
            ":now": now,
            ":userId": params.userId,
          }),
          ReturnValues: "ALL_NEW",
        }),
      );

      const closedFiscalYear = FiscalYearSchema.parse(
        unmarshall(result.Attributes ?? {}),
      );

      return {
        fiscalYear: ClosingService.toFiscalYearDto(closedFiscalYear),
        checks,
      };
    } catch (error: any) {
      if (error?.name === "ConditionalCheckFailedException") {
        throw new AppError(409, "ERROR_FISCAL_YEAR_CLOSE_CONFLICT");
      }
      throw error;
    }
  }

  private static async getFiscalYear(
    orgId: string,
    year: string,
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

    return FiscalYearSchema.parse(unmarshall(result.Item));
  }

  private static async listEntryHeaders(
    orgId: string,
    year: string,
  ): Promise<Entry[]> {
    return ClosingService.queryFiscalYearItems(
      orgId,
      year,
      "E#",
      EntrySchema,
    );
  }

  private static async listEntryLines(
    orgId: string,
    year: string,
  ): Promise<EntryLine[]> {
    return ClosingService.queryFiscalYearItems(
      orgId,
      year,
      "L#",
      EntryLineSchema,
    );
  }

  private static async queryFiscalYearItems<T>(
    orgId: string,
    year: string,
    skPrefix: string,
    schema: { parse: (value: unknown) => T },
  ): Promise<T[]> {
    const items: T[] = [];
    let exclusiveStartKey: Record<string, any> | undefined;

    do {
      const result = await dynamoClient.send(
        new QueryCommand({
          TableName: config.TABLE_NAME,
          KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
          ExpressionAttributeValues: marshall({
            ":pk": KeyFactory.partitionKey(orgId, year),
            ":sk": skPrefix,
          }),
          ExclusiveStartKey: exclusiveStartKey,
          ScanIndexForward: true,
        }),
      );

      for (const item of result.Items ?? []) {
        items.push(schema.parse(unmarshall(item)));
      }

      exclusiveStartKey = result.LastEvaluatedKey;
    } while (exclusiveStartKey);

    return items;
  }

  private static async getAccounts(
    orgId: string,
    accountIds: string[],
  ): Promise<Map<string, Partial<Account> & { accountId: string }>> {
    const uniqueAccountIds = [...new Set(accountIds)].filter(Boolean);
    const accounts = new Map<string, Partial<Account> & { accountId: string }>();

    for (let offset = 0; offset < uniqueAccountIds.length; offset += 100) {
      let keys = uniqueAccountIds.slice(offset, offset + 100).map((accountId) =>
        marshall({
          PK: KeyFactory.orgKey(orgId),
          SK: KeyFactory.accountSK(accountId),
        }),
      );

      do {
        const result = await dynamoClient.send(
          new BatchGetItemCommand({
            RequestItems: {
              [config.TABLE_NAME]: {
                Keys: keys,
              },
            },
          }),
        );

        for (const item of result.Responses?.[config.TABLE_NAME] ?? []) {
          const account = unmarshall(item) as Partial<Account> & {
            accountId?: string;
          };
          if (account.accountId) {
            accounts.set(account.accountId, {
              ...account,
              accountId: account.accountId,
            });
          }
        }

        keys = result.UnprocessedKeys?.[config.TABLE_NAME]?.Keys ?? [];
      } while (keys.length > 0);
    }

    return accounts;
  }

  private static groupLinesByEntry(
    lines: EntryLine[],
  ): Map<string, EntryLine[]> {
    const grouped = new Map<string, EntryLine[]>();

    for (const line of lines) {
      const entryLines = grouped.get(line.entryId) ?? [];
      entryLines.push(line);
      grouped.set(line.entryId, entryLines);
    }

    return grouped;
  }

  private static resolveAccountAuxiliary(
    account: Partial<Account> & { accountId: string },
  ) {
    try {
      return resolveAuxiliaryMetadata({
        accountId: account.accountId,
        isThirdPartyAccount: account.isThirdPartyAccount ?? false,
        requiresThirdParty: account.requiresThirdParty,
        auxiliaryType: account.auxiliaryType,
      });
    } catch {
      return undefined;
    }
  }

  private static toFiscalYearDto(fiscalYear: FiscalYear) {
    return FiscalYearDtoSchema.parse({
      orgId: fiscalYear.orgId,
      year: fiscalYear.year,
      fiscalYearId: fiscalYear.fiscalYearId,
      startDate: fiscalYear.startDate,
      endDate: fiscalYear.endDate,
      status: fiscalYear.status,
      accountingFramework: fiscalYear.accountingFramework,
      ranEntryId: fiscalYear.ranEntryId,
      createdAt: fiscalYear.createdAt,
      updatedAt: fiscalYear.updatedAt,
    });
  }
}
