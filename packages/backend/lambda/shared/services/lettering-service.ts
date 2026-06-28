// lambda/shared/services/lettering-service.ts

import { config } from "@/lambda/shared/config";
import { dynamoClient } from "@/lambda/shared/dynamo-client";
import { KeyFactory } from "@/lambda/shared/key-builder";
import { AppError } from "@/lambda/shared/middleware/handler-wrapper";
import {
  BatchGetItemCommand,
  GetItemCommand,
  QueryCommand,
  TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import {
  AccountEntryDtoSchema,
  CreateLetteringMatchRequest,
  EntryLine,
  EntryLineSchema,
  FiscalYearSchema,
  LetteringCandidatesDto,
  LetteringCandidatesDtoSchema,
  LetteringCandidatesQuery,
  LetteringMatchDto,
  LetteringMatchDtoSchema,
  ThirdPartyTypeValue,
} from "@liass-ohada/shared/accounting";
import { createHash } from "crypto";
import { resolveAuxiliaryMetadata } from "../account-auxiliary";
import { LockPeriodService } from "./lock-period-service";
import { ThirdPartyService } from "./third-party-service";

interface FIFOCandidate {
  lineId: string;
  entryId: string;
  entryDate: string;
  debit: number;
  credit: number;
  label?: string;
  projectId?: string;
  remainingAmount: number;
}

export interface LineRef {
  year: number;
  entryId: string;
  lineId: string;
}

interface LetteringMatchItem extends LetteringMatchDto {
  orgId: string;
  entityType: "LETTERING_MATCH";
  PK: string;
  SK: string;
  updatedAt?: string;
  updatedBy?: string;
}

interface LetteringScope {
  accountId: string;
  thirdPartyId: string;
  thirdPartyType: ThirdPartyTypeValue;
  fiscalYear: number;
}

export class LetteringService {
  /**
   * Retrieves permanent auxiliary history from GSI2 and groups it by lettering
   * status. GSI3 is only the operational queue of lines still eligible for
   * lettering and must not be used as the accounting history.
   */
  static async getThirdPartyReport(
    orgId: string,
    accountId: string,
    thirdPartyId: string,
  ) {
    const normalizedAccountId = accountId.padEnd(8, "0");
    const queryResult = await dynamoClient.send(
      new QueryCommand({
        TableName: config.TABLE_NAME,
        IndexName: config.GSI2,
        KeyConditionExpression: "GSI2PK = :pk",
        ExpressionAttributeValues: marshall({
          ":pk": KeyFactory.gsi2PK(
            orgId,
            normalizedAccountId,
            thirdPartyId,
          ),
        }),
        ScanIndexForward: true,
      }),
    );

    const items = (queryResult.Items || []).map((i) =>
      LetteringService.toPublicLine(unmarshall(i)),
    );

    const letteredGroups: Record<string, any[]> = {};
    const unletteredLines: any[] = [];
    let totalDebit = 0;
    let totalCredit = 0;

    items.forEach((line) => {
      const debit = Number(line.debit) || 0;
      const credit = Number(line.credit) || 0;
      totalDebit += debit;
      totalCredit += credit;

      if (line.letteringCode) {
        if (!letteredGroups[line.letteringCode]) {
          letteredGroups[line.letteringCode] = [];
        }
        letteredGroups[line.letteringCode].push(line);
      } else {
        unletteredLines.push(line);
      }
    });

    return {
      summary: {
        totalDebit,
        totalCredit,
        balance: totalDebit - totalCredit,
      },
      letteredGroups,
      unletteredLines,
    };
  }

  static async getUnletteredLines(
    orgId: string,
    accountId: string,
    thirdPartyId: string,
    projectId?: string,
  ) {
    const normalizedAccountId = accountId.padEnd(8, "0");
    const queryInput: any = {
      TableName: config.TABLE_NAME,
      IndexName: config.GSI3,
      KeyConditionExpression: "GSI3PK = :lpk AND begins_with(GSI3SK, :lsk)",
      ExpressionAttributeValues: marshall({
        ":lpk": KeyFactory.unletteredPK(
          orgId,
          normalizedAccountId,
          thirdPartyId,
        ),
        ":lsk": KeyFactory.unletteredSKPrefix(),
        ...(projectId ? { ":pid": projectId } : {}),
      }),
    };

    if (projectId) {
      queryInput.FilterExpression = "projectId = :pid";
    }

    const result = await dynamoClient.send(new QueryCommand(queryInput));
    const unletteredLines = (result.Items || []).map((item) =>
      LetteringService.toPublicLine(unmarshall(item)),
    );

    if (unletteredLines.length === 0) {
      return {
        totalUnlettered: 0,
        suggestionsFound: 0,
        unletteredLines: [],
        suggestions: [],
      };
    }

    const debits = unletteredLines.filter((line) => Number(line.debit) > 0);
    const credits = unletteredLines.filter((line) => Number(line.credit) > 0);
    const suggestions: any[] = [];
    const matchedIds = new Set<string>();

    for (const debitLine of debits) {
      const match = credits.find(
        (creditLine) =>
          Number(creditLine.credit) === Number(debitLine.debit) &&
          !matchedIds.has(creditLine.lineId),
      );

      if (match) {
        matchedIds.add(debitLine.lineId);
        matchedIds.add(match.lineId);
        suggestions.push({
          type: "PERFECT_MATCH",
          amount: Number(debitLine.debit),
          lines: [
            {
              lineId: debitLine.lineId,
              entryId: debitLine.entryId,
              date: debitLine.entryDate,
              label: debitLine.label,
              amount: debitLine.debit,
              type: "DEBIT",
              projectId: debitLine.projectId,
            },
            {
              lineId: match.lineId,
              entryId: match.entryId,
              date: match.entryDate,
              label: match.label,
              amount: match.credit,
              type: "CREDIT",
              projectId: match.projectId,
            },
          ],
        });
      }
    }

    const tempDebits: FIFOCandidate[] = debits
      .filter((line) => !matchedIds.has(line.lineId))
      .sort((a, b) => a.entryDate.localeCompare(b.entryDate))
      .map((line) => ({
        ...line,
        remainingAmount: Number(line.debit),
      })) as FIFOCandidate[];

    const tempCredits: FIFOCandidate[] = credits
      .filter((line) => !matchedIds.has(line.lineId))
      .sort((a, b) => a.entryDate.localeCompare(b.entryDate))
      .map((line) => ({
        ...line,
        remainingAmount: Number(line.credit),
      })) as FIFOCandidate[];

    let debitIndex = 0;
    let creditIndex = 0;

    while (debitIndex < tempDebits.length && creditIndex < tempCredits.length) {
      const debitLine = tempDebits[debitIndex];
      const creditLine = tempCredits[creditIndex];
      const matchAmount = Math.min(
        debitLine.remainingAmount,
        creditLine.remainingAmount,
      );

      if (matchAmount > 0) {
        suggestions.push({
          type: "FIFO_SUGGESTION",
          amount: matchAmount,
          lines: [
            {
              lineId: debitLine.lineId,
              entryId: debitLine.entryId,
              date: debitLine.entryDate,
              amount: debitLine.debit,
              projectId: debitLine.projectId,
            },
            {
              lineId: creditLine.lineId,
              entryId: creditLine.entryId,
              date: creditLine.entryDate,
              amount: creditLine.credit,
              projectId: creditLine.projectId,
            },
          ],
        });
      }

      debitLine.remainingAmount -= matchAmount;
      creditLine.remainingAmount -= matchAmount;

      if (debitLine.remainingAmount <= 0) debitIndex++;
      if (creditLine.remainingAmount <= 0) creditIndex++;
    }

    return {
      totalUnlettered: unletteredLines.length,
      suggestionsFound: suggestions.length,
      unletteredLines,
      suggestions,
    };
  }

  static async listCandidates(
    orgId: string,
    params: LetteringCandidatesQuery,
  ): Promise<LetteringCandidatesDto> {
    const scope = await LetteringService.validateLetteringScope(orgId, {
      accountId: params.accountId,
      thirdPartyId: params.thirdPartyId,
      thirdPartyType: params.thirdPartyType,
      fiscalYear: params.fiscalYear,
    });

    const exclusiveStartKey = LetteringService.decodeCursor(params.cursor);
    const values: Record<string, unknown> = {
      ":pk": KeyFactory.unletteredPK(
        orgId,
        scope.accountId,
        scope.thirdPartyId,
      ),
    };
    let keyCondition =
      "GSI3PK = :pk AND begins_with(GSI3SK, :unletteredPrefix)";
    values[":unletteredPrefix"] = KeyFactory.unletteredSKPrefix();

    if (params.dateFrom && params.dateTo) {
      keyCondition = "GSI3PK = :pk AND GSI3SK BETWEEN :from AND :to";
      values[":from"] = KeyFactory.letteringSK(params.dateFrom, "", "");
      values[":to"] = KeyFactory.letteringSK(
        params.dateTo,
        "\uffff",
        "\uffff",
      );
    }

    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: config.TABLE_NAME,
        IndexName: config.GSI3,
        KeyConditionExpression: keyCondition,
        ExpressionAttributeValues: marshall(values),
        ExclusiveStartKey: exclusiveStartKey,
        Limit: params.limit ?? 50,
        ScanIndexForward: true,
      }),
    );

    const lines = (result.Items ?? [])
      .map((item) => EntryLineSchema.parse(unmarshall(item)))
      .filter((line) =>
        LetteringService.isCandidateLine(line, orgId, {
          ...scope,
          dateFrom: params.dateFrom,
          dateTo: params.dateTo,
        }),
      )
      .map((line) => LetteringService.toUnletteredLineDto(line));

    return LetteringCandidatesDtoSchema.parse({
      accountId: scope.accountId,
      accountCode: lines[0]?.accountCode,
      thirdPartyId: scope.thirdPartyId,
      thirdPartyType: scope.thirdPartyType,
      thirdPartyName: lines[0]?.thirdPartyName,
      lines,
      nextCursor: LetteringService.encodeCursor(result.LastEvaluatedKey),
      hasMore: !!result.LastEvaluatedKey,
    });
  }

  static async createManualMatch(
    orgId: string,
    userId: string,
    input: CreateLetteringMatchRequest,
  ): Promise<LetteringMatchDto> {
    const scope = await LetteringService.validateLetteringScope(orgId, {
      accountId: input.accountId,
      thirdPartyId: input.thirdPartyId,
      thirdPartyType: input.thirdPartyType,
      fiscalYear: input.fiscalYear,
    });

    const normalizedAllocations = input.allocations.map((allocation) => ({
      ...allocation,
      amount: Math.round(allocation.amount),
    }));
    const allocationKeys = new Set(
      normalizedAllocations.map(
        (allocation) => `${allocation.entryId}#${allocation.lineId}`,
      ),
    );
    if (allocationKeys.size !== normalizedAllocations.length) {
      throw new AppError(400, "ERROR_LETTERING_DUPLICATE_LINE");
    }

    const lines = await LetteringService.getLinesByRefs(
      orgId,
      normalizedAllocations.map((allocation) => ({
        year: scope.fiscalYear,
        entryId: allocation.entryId,
        lineId: allocation.lineId,
      })),
    );
    const linesByKey = new Map(
      lines.map((line) => [`${line.entryId}#${line.lineId}`, line]),
    );
    let totalDebit = 0;
    let totalCredit = 0;

    const allocationDtos = normalizedAllocations.map((allocation) => {
      const line = linesByKey.get(`${allocation.entryId}#${allocation.lineId}`);
      if (!line) {
        throw new AppError(400, "ERROR_SOME_LINES_NOT_FOUND");
      }

      LetteringService.assertLineEligibleForManualMatch(line, orgId, scope);
      const remainingAmount = LetteringService.lineRemainingAmount(line);
      if (allocation.amount > remainingAmount) {
        throw new AppError(400, "ERROR_LETTERING_AMOUNT_EXCEEDS_REMAINING");
      }

      if (line.debit > 0) {
        totalDebit += allocation.amount;
      } else if (line.credit > 0) {
        totalCredit += allocation.amount;
      } else {
        throw new AppError(400, "ERROR_LETTERING_INVALID_LINE_AMOUNT");
      }

      return {
        entryId: line.entryId,
        lineId: line.lineId,
        accountingDate: line.entryDate,
        journalCode: line.journalCode,
        entryNumber: line.entryId,
        reference: line.voucherNumber,
        label: line.label || line.description,
        debit: line.debit,
        credit: line.credit,
        allocatedAmount: allocation.amount,
      };
    });

    if (totalDebit <= 0 || totalCredit <= 0 || totalDebit !== totalCredit) {
      throw new AppError(400, "ERROR_LETTERING_UNBALANCED");
    }

    const letteringId = LetteringService.buildDeterministicLetteringId({
      orgId,
      scope,
      allocations: normalizedAllocations,
      note: input.note,
    });
    const accountCode = lines[0]?.accountCode ?? scope.accountId;
    const now = new Date().toISOString();
    const matchItem: LetteringMatchItem = {
      orgId,
      letteringId,
      fiscalYear: scope.fiscalYear,
      accountId: scope.accountId,
      accountCode,
      thirdPartyId: scope.thirdPartyId,
      thirdPartyType: scope.thirdPartyType,
      status: "ACTIVE",
      totalDebit,
      totalCredit,
      note: input.note,
      createdAt: now,
      createdBy: userId,
      updatedAt: now,
      updatedBy: userId,
      allocations: allocationDtos,
      entityType: "LETTERING_MATCH",
      PK: KeyFactory.partitionKey(orgId, scope.fiscalYear),
      SK: KeyFactory.letteringMatchSK(letteringId),
    };

    const transactItems: any[] = [
      {
        Put: {
          TableName: config.TABLE_NAME,
          Item: marshall(matchItem, { removeUndefinedValues: true }),
          ConditionExpression:
            "attribute_not_exists(PK) AND attribute_not_exists(SK)",
        },
      },
    ];

    for (const allocation of normalizedAllocations) {
      const line = linesByKey.get(`${allocation.entryId}#${allocation.lineId}`)!;
      transactItems.push(
        LetteringService.buildApplyAllocationUpdate({
          orgId,
          userId,
          now,
          scope,
          line,
          allocationAmount: allocation.amount,
          letteringId,
        }),
      );
    }

    try {
      await dynamoClient.send(
        new TransactWriteItemsCommand({ TransactItems: transactItems }),
      );
    } catch (error: any) {
      if (error?.name === "TransactionCanceledException") {
        const existing = await LetteringService.getMatchItem(
          orgId,
          scope.fiscalYear,
          letteringId,
        ).catch(() => undefined);
        if (existing?.status === "ACTIVE") {
          return LetteringService.toMatchDto(existing);
        }
        throw new AppError(409, "ERROR_LETTERING_CONFLICT");
      }
      throw error;
    }

    return LetteringService.toMatchDto(matchItem);
  }

  static async getMatch(
    orgId: string,
    fiscalYear: number,
    letteringId: string,
  ): Promise<LetteringMatchDto> {
    return LetteringService.toMatchDto(
      await LetteringService.getMatchItem(orgId, fiscalYear, letteringId),
    );
  }

  static async cancelMatch(
    orgId: string,
    userId: string,
    params: {
      fiscalYear: number;
      letteringId: string;
      cancellationReason?: string;
    },
  ): Promise<LetteringMatchDto> {
    const match = await LetteringService.getMatchItem(
      orgId,
      params.fiscalYear,
      params.letteringId,
    );

    if (match.status === "CANCELLED") {
      throw new AppError(409, "ERROR_LETTERING_MATCH_ALREADY_CANCELLED");
    }

    const lines = await LetteringService.getLinesByRefs(
      orgId,
      match.allocations.map((allocation) => ({
        year: match.fiscalYear,
        entryId: allocation.entryId,
        lineId: allocation.lineId,
      })),
    );
    const linesByKey = new Map(
      lines.map((line) => [`${line.entryId}#${line.lineId}`, line]),
    );
    const now = new Date().toISOString();
    const matchSetExpressions = [
      "#status = :cancelled",
      "cancelledAt = :now",
      "cancelledBy = :userId",
      "updatedAt = :now",
      "updatedBy = :userId",
    ];
    const matchExpressionValues: Record<string, unknown> = {
      ":active": "ACTIVE",
      ":cancelled": "CANCELLED",
      ":now": now,
      ":userId": userId,
    };
    if (params.cancellationReason) {
      matchSetExpressions.push("cancellationReason = :reason");
      matchExpressionValues[":reason"] = params.cancellationReason;
    }

    const transactItems: any[] = [
      {
        Update: {
          TableName: config.TABLE_NAME,
          Key: marshall({
            PK: match.PK,
            SK: match.SK,
          }),
          ConditionExpression:
            "attribute_exists(PK) AND attribute_exists(SK) AND #status = :active",
          UpdateExpression: `SET ${matchSetExpressions.join(", ")}`,
          ExpressionAttributeNames: {
            "#status": "status",
          },
          ExpressionAttributeValues: marshall(matchExpressionValues),
        },
      },
    ];

    for (const allocation of match.allocations) {
      const line = linesByKey.get(`${allocation.entryId}#${allocation.lineId}`);
      if (!line) {
        throw new AppError(400, "ERROR_SOME_LINES_NOT_FOUND");
      }
      LetteringService.assertLineBelongsToMatchScope(line, match);
      transactItems.push(
        LetteringService.buildCancelAllocationUpdate({
          orgId,
          userId,
          now,
          line,
          allocationAmount: allocation.allocatedAmount,
          letteringId: match.letteringId,
        }),
      );
    }

    try {
      await dynamoClient.send(
        new TransactWriteItemsCommand({ TransactItems: transactItems }),
      );
    } catch (error: any) {
      if (error?.name === "TransactionCanceledException") {
        throw new AppError(400, "ERROR_UNLETTERING_CONDITION_FAILED");
      }
      throw error;
    }

    return LetteringService.toMatchDto({
      ...match,
      status: "CANCELLED",
      cancelledAt: now,
      cancelledBy: userId,
      cancellationReason: params.cancellationReason,
      updatedAt: now,
      updatedBy: userId,
    });
  }

  static async postLettering(
    orgId: string,
    userId: string,
    params: {
      accountId: string;
      thirdPartyId: string;
      lines: LineRef[];
      letteringCode: string;
    },
  ) {
    if (params.lines.length < 2) {
      throw new AppError(400, "ERROR_LETTERING_INSUFFICIENT_DATA");
    }

    const organization = await LetteringService.getOrganization(orgId);
    const isSYCEBNL = organization.accountingFramework === "SYCEBNL";
    const lines = await LetteringService.getLinesByRefs(orgId, params.lines);
    const normalizedAccountId = params.accountId.padEnd(8, "0");

    if (await LockPeriodService.isPeriodLocked(orgId, lines[0].entryDate)) {
      throw new AppError(400, "ERROR_PERIOD_LOCKED");
    }

    const firstLine = lines[0];
    for (const line of lines) {
      if (
        line.accountId !== normalizedAccountId ||
        line.accountId !== firstLine.accountId ||
        line.thirdPartyId !== params.thirdPartyId ||
        line.thirdPartyId !== firstLine.thirdPartyId
      ) {
        throw new AppError(400, "ERROR_INCONSISTENT_ACCOUNT_OR_THIRD_PARTY");
      }

      if (
        isSYCEBNL &&
        (!line.projectId || line.projectId !== firstLine.projectId)
      ) {
        throw new AppError(400, "ERROR_INCONSISTENT_PROJECTS");
      }
    }

    const totalBalance = lines.reduce(
      (total, line) => total + (line.debit - line.credit),
      0,
    );
    const isComplete = totalBalance === 0;
    const finalCode = isComplete
      ? params.letteringCode.toUpperCase()
      : params.letteringCode.toLowerCase();
    const letteringStatus = isComplete ? "COMPLETE" : "PARTIAL";
    const now = new Date().toISOString();

    const transactItems = lines.map((line) => {
      const commonValues = {
        ":complete": "COMPLETE",
        ":code": finalCode,
        ":status": letteringStatus,
        ":now": now,
        ":userId": userId,
      };
      return {
        Update: {
          TableName: config.TABLE_NAME,
          Key: marshall({ PK: line.PK, SK: line.SK }),
          ConditionExpression:
            "attribute_exists(PK) AND attribute_exists(SK) AND attribute_exists(GSI3PK) AND (attribute_not_exists(letteringStatus) OR letteringStatus <> :complete)",
          UpdateExpression: isComplete
            ? "SET letteringCode = :code, letteringStatus = :status, updatedAt = :now, updatedBy = :userId REMOVE GSI3PK, GSI3SK"
            : "SET letteringCode = :code, letteringStatus = :status, updatedAt = :now, updatedBy = :userId",
          ExpressionAttributeValues: marshall(commonValues),
        },
      };
    });

    try {
      await dynamoClient.send(
        new TransactWriteItemsCommand({ TransactItems: transactItems }),
      );
    } catch (error: any) {
      if (error?.name === "TransactionCanceledException") {
        throw new AppError(400, "ERROR_ALREADY_LETTERED_OR_MISSING");
      }
      throw error;
    }

    return {
      letteringCode: finalCode,
      letteringStatus,
      remainingBalance: Math.abs(totalBalance),
    };
  }

  static async cancelLettering(
    orgId: string,
    userId: string,
    params: {
      accountId: string;
      thirdPartyId: string;
      lines: LineRef[];
    },
  ) {
    const lines = await LetteringService.getLinesByRefs(orgId, params.lines);
    const normalizedAccountId = params.accountId.padEnd(8, "0");

    if (await LockPeriodService.isPeriodLocked(orgId, lines[0].entryDate)) {
      throw new AppError(400, "ERROR_PERIOD_LOCKED");
    }

    if (
      !lines.every(
        (line) =>
          line.accountId === normalizedAccountId &&
          line.thirdPartyId === params.thirdPartyId,
      )
    ) {
      throw new AppError(400, "ERROR_INCONSISTENT_ACCOUNT_OR_THIRD_PARTY");
    }

    const now = new Date().toISOString();
    const transactItems = lines.map((line) => ({
      Update: {
        TableName: config.TABLE_NAME,
        Key: marshall({ PK: line.PK, SK: line.SK }),
        ConditionExpression:
          "attribute_exists(PK) AND attribute_exists(SK) AND attribute_exists(letteringCode)",
        UpdateExpression:
          "SET GSI3PK = :restoredLPk, GSI3SK = :restoredLSk, updatedAt = :now, updatedBy = :userId REMOVE letteringCode, letteringStatus",
        ExpressionAttributeValues: marshall({
          ":restoredLPk": KeyFactory.unletteredPK(
            orgId,
            line.accountId,
            line.thirdPartyId!,
          ),
          ":restoredLSk": KeyFactory.letteringSK(
            line.entryDate,
            line.entryId,
            (line.postingOrdinal ?? line.lineId)
              .toString()
              .padStart(4, "0"),
          ),
          ":now": now,
          ":userId": userId,
        }),
      },
    }));

    try {
      await dynamoClient.send(
        new TransactWriteItemsCommand({ TransactItems: transactItems }),
      );
    } catch (error: any) {
      if (error?.name === "TransactionCanceledException") {
        throw new AppError(400, "ERROR_UNLETTERING_CONDITION_FAILED");
      }
      throw error;
    }

    return { linesProcessed: lines.length };
  }

  private static async getOrganization(orgId: string) {
    const result = await dynamoClient.send(
      new GetItemCommand({
        TableName: config.TABLE_NAME,
        Key: marshall({
          PK: KeyFactory.orgKey(orgId),
          SK: KeyFactory.organizationSK(),
        }),
      }),
    );

    return result.Item ? unmarshall(result.Item) : {};
  }

  private static async getLinesByRefs(orgId: string, lineRefs: LineRef[]) {
    if (!Array.isArray(lineRefs) || lineRefs.length === 0) {
      throw new AppError(400, "ERROR_MISSING_PARAMETERS");
    }

    const result = await dynamoClient.send(
      new BatchGetItemCommand({
        RequestItems: {
          [config.TABLE_NAME]: {
            Keys: lineRefs.map((ref) =>
              marshall({
                PK: KeyFactory.partitionKey(orgId, ref.year),
                SK: KeyFactory.entryLineSK(ref.lineId),
              }),
            ),
          },
        },
      }),
    );

    const lines = (result.Responses?.[config.TABLE_NAME] || []).map((item) =>
      EntryLineSchema.parse(unmarshall(item)),
    );

    if (lines.length !== lineRefs.length) {
      throw new AppError(400, "ERROR_SOME_LINES_NOT_FOUND");
    }

    if (!lines.every((line) => line.orgId === orgId)) {
      throw new AppError(403, "UNAUTHORIZED");
    }

    const requested = new Set(
      lineRefs.map((ref) => `${ref.year}#${ref.entryId}#${ref.lineId}`),
    );
    if (
      !lines.every((line) =>
        requested.has(`${line.year}#${line.entryId}#${line.lineId}`),
      )
    ) {
      throw new AppError(400, "ERROR_SOME_LINES_NOT_FOUND");
    }

    return lines;
  }

  private static async validateLetteringScope(
    orgId: string,
    scope: LetteringScope,
  ): Promise<LetteringScope> {
    const normalizedScope = {
      ...scope,
      accountId: scope.accountId.padEnd(8, "0"),
    };
    await LetteringService.getFiscalYear(orgId, normalizedScope.fiscalYear);
    const account = await LetteringService.getAccountForLettering(
      orgId,
      normalizedScope.accountId,
      normalizedScope.thirdPartyType,
    );
    const thirdParty = await ThirdPartyService.getItem(
      orgId,
      normalizedScope.thirdPartyType,
      normalizedScope.thirdPartyId,
    );

    if (thirdParty.status !== "ACTIVE") {
      throw new AppError(400, "THIRD_PARTY_INACTIVE");
    }

    if (thirdParty.type !== normalizedScope.thirdPartyType) {
      throw new AppError(400, "THIRD_PARTY_TYPE_MISMATCH");
    }

    return {
      ...normalizedScope,
      accountId: account.accountId,
    };
  }

  private static async getFiscalYear(orgId: string, fiscalYear: number) {
    const result = await dynamoClient.send(
      new GetItemCommand({
        TableName: config.TABLE_NAME,
        Key: marshall({
          PK: KeyFactory.orgKey(orgId),
          SK: KeyFactory.fiscalYearSK(fiscalYear),
        }),
      }),
    );

    if (!result.Item) {
      throw new AppError(404, "ERROR_FISCAL_YEAR_NOT_FOUND");
    }

    return FiscalYearSchema.parse(unmarshall(result.Item));
  }

  private static async getAccountForLettering(
    orgId: string,
    accountId: string,
    thirdPartyType: ThirdPartyTypeValue,
  ) {
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

    const account = unmarshall(result.Item) as any;
    if (
      account.orgId !== orgId ||
      account.entityType !== "ACCOUNT" ||
      account.accountId !== accountId
    ) {
      throw new AppError(404, "ERROR_ACCOUNT_NOT_FOUND");
    }

    if (account.isActive === false) {
      throw new AppError(400, "ERROR_ACCOUNT_INACTIVE");
    }

    const metadata = resolveAuxiliaryMetadata(account);
    if (!metadata.requiresThirdParty || metadata.auxiliaryType === "NONE") {
      throw new AppError(400, "THIRD_PARTY_NOT_ALLOWED");
    }

    if (
      metadata.auxiliaryType !== "THIRD_PARTY" &&
      metadata.auxiliaryType !== thirdPartyType
    ) {
      throw new AppError(400, "THIRD_PARTY_TYPE_MISMATCH");
    }

    return account as { accountId: string; accountName?: string };
  }

  private static async getMatchItem(
    orgId: string,
    fiscalYear: number,
    letteringId: string,
  ): Promise<LetteringMatchItem> {
    const result = await dynamoClient.send(
      new GetItemCommand({
        TableName: config.TABLE_NAME,
        Key: marshall({
          PK: KeyFactory.partitionKey(orgId, fiscalYear),
          SK: KeyFactory.letteringMatchSK(letteringId),
        }),
      }),
    );

    if (!result.Item) {
      throw new AppError(404, "ERROR_LETTERING_MATCH_NOT_FOUND");
    }

    const item = unmarshall(result.Item) as LetteringMatchItem;
    if (
      item.orgId !== orgId ||
      item.fiscalYear !== fiscalYear ||
      item.entityType !== "LETTERING_MATCH"
    ) {
      throw new AppError(404, "ERROR_LETTERING_MATCH_NOT_FOUND");
    }

    return item;
  }

  private static isCandidateLine(
    line: EntryLine,
    orgId: string,
    scope: LetteringScope & { dateFrom?: string; dateTo?: string },
  ): boolean {
    return (
      line.orgId === orgId &&
      line.entityType === "ENTRY_LINE" &&
      line.year === scope.fiscalYear &&
      line.accountId === scope.accountId &&
      line.thirdPartyId === scope.thirdPartyId &&
      line.thirdPartyType === scope.thirdPartyType &&
      !!line.GSI2PK &&
      !!line.GSI2SK &&
      !!line.GSI3PK &&
      !!line.GSI3SK &&
      (!scope.dateFrom || line.entryDate >= scope.dateFrom) &&
      (!scope.dateTo || line.entryDate <= scope.dateTo) &&
      LetteringService.lineRemainingAmount(line) > 0
    );
  }

  private static assertLineEligibleForManualMatch(
    line: EntryLine,
    orgId: string,
    scope: LetteringScope,
  ): void {
    if (
      line.orgId !== orgId ||
      line.entityType !== "ENTRY_LINE" ||
      line.year !== scope.fiscalYear ||
      line.accountId !== scope.accountId ||
      line.thirdPartyId !== scope.thirdPartyId ||
      line.thirdPartyType !== scope.thirdPartyType ||
      !line.GSI2PK ||
      !line.GSI2SK ||
      !line.GSI3PK ||
      !line.GSI3SK
    ) {
      throw new AppError(400, "ERROR_LETTERING_LINE_NOT_ELIGIBLE");
    }

    if (LetteringService.lineRemainingAmount(line) <= 0) {
      throw new AppError(400, "ERROR_ALREADY_LETTERED_OR_MISSING");
    }
  }

  private static assertLineBelongsToMatchScope(
    line: EntryLine,
    match: LetteringMatchItem,
  ): void {
    if (
      line.entityType !== "ENTRY_LINE" ||
      line.orgId !== match.orgId ||
      line.year !== match.fiscalYear ||
      line.accountId !== match.accountId ||
      line.thirdPartyId !== match.thirdPartyId ||
      line.thirdPartyType !== match.thirdPartyType ||
      !line.GSI2PK ||
      !line.GSI2SK
    ) {
      throw new AppError(400, "ERROR_UNLETTERING_CONDITION_FAILED");
    }
  }

  private static lineOriginalAmount(line: EntryLine): number {
    return Math.max(Number(line.debit) || 0, Number(line.credit) || 0);
  }

  private static lineLetteredAmount(line: EntryLine): number {
    const originalAmount = LetteringService.lineOriginalAmount(line);
    if (typeof line.letteredAmount === "number") {
      return Math.min(line.letteredAmount, originalAmount);
    }

    if (line.letteringStatus === "COMPLETE" || line.letteringStatus === "LETTERED") {
      return originalAmount;
    }

    return 0;
  }

  private static lineRemainingAmount(line: EntryLine): number {
    const originalAmount = LetteringService.lineOriginalAmount(line);
    if (typeof line.remainingAmount === "number") {
      return Math.max(0, Math.min(line.remainingAmount, originalAmount));
    }

    return Math.max(0, originalAmount - LetteringService.lineLetteredAmount(line));
  }

  private static toUnletteredLineDto(line: EntryLine) {
    const originalAmount = LetteringService.lineOriginalAmount(line);
    const remainingAmount = LetteringService.lineRemainingAmount(line);
    const letteredAmount = Math.max(0, originalAmount - remainingAmount);

    return {
      entryId: line.entryId,
      lineId: line.lineId,
      stableLineIndex: line.postingOrdinal,
      fiscalYear: line.year,
      accountingDate: line.entryDate,
      journalCode: line.journalCode,
      entryNumber: line.entryId,
      reference: line.voucherNumber,
      accountId: line.accountId,
      accountCode: line.accountCode ?? line.accountId,
      accountLabel: line.accountLabel,
      thirdPartyId: line.thirdPartyId!,
      thirdPartyType: line.thirdPartyType!,
      thirdPartyCode: line.thirdPartyCode,
      thirdPartyName: line.thirdPartyName,
      label: line.label || line.description,
      debit: Number(line.debit) || 0,
      credit: Number(line.credit) || 0,
      originalAmount,
      letteredAmount,
      remainingAmount,
      letteringStatus: letteredAmount > 0 ? "PARTIAL" : "UNLETTERED",
      letteringMatchIds: line.letteringMatchIds,
    };
  }

  private static buildApplyAllocationUpdate(params: {
    orgId: string;
    userId: string;
    now: string;
    scope: LetteringScope;
    line: EntryLine;
    allocationAmount: number;
    letteringId: string;
  }) {
    const {
      orgId,
      userId,
      now,
      scope,
      line,
      allocationAmount,
      letteringId,
    } = params;
    const originalAmount = LetteringService.lineOriginalAmount(line);
    const currentLetteredAmount = LetteringService.lineLetteredAmount(line);
    const newLetteredAmount = currentLetteredAmount + allocationAmount;
    const newRemainingAmount = Math.max(0, originalAmount - newLetteredAmount);
    const nextMatchIds = [
      ...new Set([...(line.letteringMatchIds ?? []), letteringId]),
    ].slice(-50);
    const isFullyLettered = newRemainingAmount === 0;
    const expressionValues: Record<string, unknown> = {
      ":lineType": "ENTRY_LINE",
      ":accountId": scope.accountId,
      ":thirdPartyId": scope.thirdPartyId,
      ":thirdPartyType": scope.thirdPartyType,
      ":allocation": allocationAmount,
      ":newLetteredAmount": newLetteredAmount,
      ":newRemainingAmount": newRemainingAmount,
      ":letteringStatus": isFullyLettered ? "LETTERED" : "PARTIAL",
      ":matchIds": nextMatchIds,
      ":now": now,
      ":userId": userId,
    };
    const setExpressions = [
      "letteredAmount = :newLetteredAmount",
      "remainingAmount = :newRemainingAmount",
      "letteringStatus = :letteringStatus",
      "letteringMatchIds = :matchIds",
      "updatedAt = :now",
      "updatedBy = :userId",
    ];

    if (!isFullyLettered) {
      expressionValues[":gsi3pk"] = KeyFactory.unletteredPK(
        orgId,
        scope.accountId,
        scope.thirdPartyId,
      );
      expressionValues[":gsi3sk"] = KeyFactory.letteringSK(
        line.entryDate,
        line.entryId,
        (line.postingOrdinal ?? line.lineId).toString().padStart(4, "0"),
      );
      setExpressions.push("GSI3PK = :gsi3pk", "GSI3SK = :gsi3sk");
    }

    return {
      Update: {
        TableName: config.TABLE_NAME,
        Key: marshall({
          PK: line.PK,
          SK: line.SK,
        }),
        ConditionExpression:
          "attribute_exists(PK) AND attribute_exists(SK) AND entityType = :lineType AND accountId = :accountId AND thirdPartyId = :thirdPartyId AND thirdPartyType = :thirdPartyType AND attribute_exists(GSI2PK) AND attribute_exists(GSI2SK) AND attribute_exists(GSI3PK) AND (attribute_not_exists(remainingAmount) OR remainingAmount >= :allocation)",
        UpdateExpression: [
          `SET ${setExpressions.join(", ")}`,
          isFullyLettered ? "REMOVE GSI3PK, GSI3SK" : "",
        ]
          .filter(Boolean)
          .join(" "),
        ExpressionAttributeValues: marshall(expressionValues, {
          removeUndefinedValues: true,
        }),
      },
    };
  }

  private static buildCancelAllocationUpdate(params: {
    orgId: string;
    userId: string;
    now: string;
    line: EntryLine;
    allocationAmount: number;
    letteringId: string;
  }) {
    const { orgId, userId, now, line, allocationAmount, letteringId } = params;
    const originalAmount = LetteringService.lineOriginalAmount(line);
    const currentLetteredAmount = LetteringService.lineLetteredAmount(line);
    const newLetteredAmount = Math.max(0, currentLetteredAmount - allocationAmount);
    const newRemainingAmount = Math.max(0, originalAmount - newLetteredAmount);
    const nextMatchIds = (line.letteringMatchIds ?? []).filter(
      (matchId) => matchId !== letteringId,
    );
    const isStillFullyLettered = newRemainingAmount === 0;
    const expressionValues: Record<string, unknown> = {
      ":lineType": "ENTRY_LINE",
      ":allocation": allocationAmount,
      ":newLetteredAmount": newLetteredAmount,
      ":newRemainingAmount": newRemainingAmount,
      ":letteringStatus":
        newLetteredAmount === 0
          ? "UNLETTERED"
          : isStillFullyLettered
            ? "LETTERED"
            : "PARTIAL",
      ":matchIds": nextMatchIds,
      ":letteringId": letteringId,
      ":now": now,
      ":userId": userId,
    };
    const setExpressions = [
      "letteredAmount = :newLetteredAmount",
      "remainingAmount = :newRemainingAmount",
      "letteringStatus = :letteringStatus",
      "letteringMatchIds = :matchIds",
      "updatedAt = :now",
      "updatedBy = :userId",
    ];

    if (!isStillFullyLettered) {
      expressionValues[":gsi3pk"] = KeyFactory.unletteredPK(
        orgId,
        line.accountId,
        line.thirdPartyId!,
      );
      expressionValues[":gsi3sk"] = KeyFactory.letteringSK(
        line.entryDate,
        line.entryId,
        (line.postingOrdinal ?? line.lineId).toString().padStart(4, "0"),
      );
      setExpressions.push("GSI3PK = :gsi3pk", "GSI3SK = :gsi3sk");
    }

    return {
      Update: {
        TableName: config.TABLE_NAME,
        Key: marshall({
          PK: line.PK,
          SK: line.SK,
        }),
        ConditionExpression:
          "attribute_exists(PK) AND attribute_exists(SK) AND entityType = :lineType AND letteredAmount >= :allocation AND contains(letteringMatchIds, :letteringId)",
        UpdateExpression: [
          `SET ${setExpressions.join(", ")}`,
          isStillFullyLettered ? "REMOVE GSI3PK, GSI3SK" : "",
        ]
          .filter(Boolean)
          .join(" "),
        ExpressionAttributeValues: marshall(expressionValues, {
          removeUndefinedValues: true,
        }),
      },
    };
  }

  private static buildDeterministicLetteringId(params: {
    orgId: string;
    scope: LetteringScope;
    allocations: Array<{ entryId: string; lineId: string; amount: number }>;
    note?: string;
  }): string {
    const allocationFingerprint = [...params.allocations]
      .sort((left, right) =>
        `${left.entryId}#${left.lineId}`.localeCompare(
          `${right.entryId}#${right.lineId}`,
        ),
      )
      .map(
        (allocation) =>
          `${allocation.entryId}:${allocation.lineId}:${allocation.amount}`,
      )
      .join("|");
    const digest = createHash("sha256")
      .update(
        [
          params.orgId,
          params.scope.fiscalYear,
          params.scope.accountId,
          params.scope.thirdPartyId,
          params.scope.thirdPartyType,
          allocationFingerprint,
          params.note ?? "",
        ].join("::"),
      )
      .digest("hex")
      .slice(0, 24)
      .toUpperCase();

    return `LM-${digest}`;
  }

  private static toMatchDto(item: LetteringMatchItem): LetteringMatchDto {
    return LetteringMatchDtoSchema.parse({
      letteringId: item.letteringId,
      fiscalYear: item.fiscalYear,
      accountId: item.accountId,
      accountCode: item.accountCode,
      thirdPartyId: item.thirdPartyId,
      thirdPartyType: item.thirdPartyType,
      status: item.status,
      totalDebit: item.totalDebit,
      totalCredit: item.totalCredit,
      createdAt: item.createdAt,
      createdBy: item.createdBy,
      cancelledAt: item.cancelledAt,
      cancelledBy: item.cancelledBy,
      cancellationReason: item.cancellationReason,
      note: item.note,
      allocations: item.allocations,
    });
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

  private static toPublicLine(line: Record<string, any>) {
    return AccountEntryDtoSchema.parse({
      entryId: line.entryId,
      year: line.year,
      lineId: line.lineId,
      accountId: line.accountId,
      debit: Number(line.debit) || 0,
      credit: Number(line.credit) || 0,
      description: line.description,
      label: line.label,
      entryDate: line.entryDate,
      voucherNumber: line.voucherNumber,
      journalCode: line.journalCode,
      thirdPartyId: line.thirdPartyId,
      thirdPartyType: line.thirdPartyType,
      thirdPartyCode: line.thirdPartyCode,
      thirdPartyName: line.thirdPartyName,
      projectId: line.projectId,
      letteringCode: line.letteringCode,
      letteringStatus: line.letteringStatus,
      createdAt: line.createdAt,
    });
  }
}
