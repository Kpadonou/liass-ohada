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
import { EntryLineSchema } from "@liass-ohada/shared/accounting";
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

export interface LineKey {
  PK: string;
  SK: string;
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
    const queryResult = await dynamoClient.send(
      new QueryCommand({
        TableName: config.TABLE_NAME,
        IndexName: config.GSI3,
        KeyConditionExpression: "GSI3PK = :pk",
        ExpressionAttributeValues: marshall({
          ":pk": KeyFactory.letteringPK(orgId, accountId, thirdPartyId),
        }),
      }),
    );

    const items = (queryResult.Items || []).map((i) => unmarshall(i));

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
    const queryInput: any = {
      TableName: config.TABLE_NAME,
      IndexName: config.GSI3,
      KeyConditionExpression: "GSI3PK = :lpk AND begins_with(GSI3SK, :lsk)",
      ExpressionAttributeValues: marshall({
        ":lpk": KeyFactory.letteringPK(orgId, accountId, thirdPartyId),
        ":lsk": "UNLETTERED#",
        ...(projectId ? { ":pid": projectId } : {}),
      }),
    };

    if (projectId) {
      queryInput.FilterExpression = "projectId = :pid";
    }

    const result = await dynamoClient.send(new QueryCommand(queryInput));
    const unletteredLines = (result.Items || []).map((item) =>
      unmarshall(item),
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
    params: { year: number; lineKeys: LineKey[]; letteringCode: string },
  ) {
    if (params.lineKeys.length < 2) {
      throw new AppError(400, "ERROR_LETTERING_INSUFFICIENT_DATA");
    }

    const organization = await LetteringService.getOrganization(orgId);
    const isSYCEBNL = organization.accountingFramework === "SYCEBNL";
    const lines = await LetteringService.getLines(orgId, params.lineKeys);

    if (await LockPeriodService.isPeriodLocked(orgId, lines[0].entryDate)) {
      throw new AppError(400, "ERROR_PERIOD_LOCKED");
    }

    const firstLine = lines[0];
    for (const line of lines) {
      if (
        line.accountId !== firstLine.accountId ||
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
    lineKeys: LineKey[],
  ) {
    const lines = await LetteringService.getLines(orgId, lineKeys);

    if (await LockPeriodService.isPeriodLocked(orgId, lines[0].entryDate)) {
      throw new AppError(400, "ERROR_PERIOD_LOCKED");
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
          SK: KeyFactory.orgKey(orgId),
        }),
      }),
    );

    return result.Item ? unmarshall(result.Item) : {};
  }

  private static async getLines(orgId: string, lineKeys: LineKey[]) {
    if (!Array.isArray(lineKeys) || lineKeys.length === 0) {
      throw new AppError(400, "ERROR_MISSING_PARAMETERS");
    }

    const result = await dynamoClient.send(
      new BatchGetItemCommand({
        RequestItems: {
          [config.TABLE_NAME]: {
            Keys: lineKeys.map((key) => marshall({ PK: key.PK, SK: key.SK })),
          },
        },
      }),
    );

    const lines = (result.Responses?.[config.TABLE_NAME] || []).map((item) =>
      EntryLineSchema.parse(unmarshall(item)),
    );

    if (lines.length !== lineKeys.length) {
      throw new AppError(400, "ERROR_SOME_LINES_NOT_FOUND");
    }

    if (!lines.every((line) => line.orgId === orgId)) {
      throw new AppError(403, "UNAUTHORIZED");
    }

    return lines;
  }
}
