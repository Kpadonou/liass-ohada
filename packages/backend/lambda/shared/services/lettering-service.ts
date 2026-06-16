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
  EntryLineSchema,
} from "@liass-ohada/shared/accounting";
import { LockPeriodService } from "./lock-period-service";

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

export class LetteringService {
  /**
   * Retrieves all lines for a specific third-party and groups them by lettering status.
   * This uses the GSI3 which acts as a Sparse Index.
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
        IndexName: config.GSI3,
        KeyConditionExpression: "GSI3PK = :pk",
        ExpressionAttributeValues: marshall({
          ":pk": KeyFactory.letteringPK(
            orgId,
            normalizedAccountId,
            thirdPartyId,
          ),
        }),
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
        ":lpk": KeyFactory.letteringPK(
          orgId,
          normalizedAccountId,
          thirdPartyId,
        ),
        ":lsk": "UNLETTERED#",
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
      const originalMetadata =
        line.GSI3SK?.replace(/^UNLETTERED#/, "") ||
        `${line.entryDate}#${line.entryId}#${line.lineId}`;
      const newLSk = `LETTERED#${finalCode}#${originalMetadata}`;

      return {
        Update: {
          TableName: config.TABLE_NAME,
          Key: marshall({ PK: line.PK, SK: line.SK }),
          ConditionExpression:
            "attribute_exists(PK) AND attribute_exists(SK) AND attribute_exists(GSI3PK) AND (attribute_not_exists(letteringStatus) OR letteringStatus <> :complete)",
          UpdateExpression:
            "SET GSI3SK = :newLSk, letteringCode = :code, letteringStatus = :status, updatedAt = :now, updatedBy = :userId",
          ExpressionAttributeValues: marshall({
            ":complete": "COMPLETE",
            ":newLSk": newLSk,
            ":code": finalCode,
            ":status": letteringStatus,
            ":now": now,
            ":userId": userId,
          }),
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
          "SET GSI3SK = :restoredLSk, updatedAt = :now, updatedBy = :userId REMOVE letteringCode, letteringStatus",
        ExpressionAttributeValues: marshall({
          ":restoredLSk": KeyFactory.letteringSK(
            line.entryDate,
            line.entryId,
            line.lineId,
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
      projectId: line.projectId,
      letteringCode: line.letteringCode,
      letteringStatus: line.letteringStatus,
      createdAt: line.createdAt,
    });
  }
}
