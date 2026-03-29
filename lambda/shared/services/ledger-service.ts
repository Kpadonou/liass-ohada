import { FiscalYearSchema } from "@/models/core-ledger/fiscal-year";
import {
  BatchGetItemCommand,
  GetItemCommand,
  QueryCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { config } from "../config";
import { dynamoClient } from "../dynamo-client";
import { KeyFactory } from "../key-builder";
import { AppError } from "../middleware/handler-wrapper";

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

/**
 * Service handling Core Ledger operations and validations.
 */
export class LedgerService {
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
   * Retrieves paginated entries for a specific account.
   */
  static async getAccountEntries(
    orgId: string,
    fiscalYear: string,
    accountId: string,
    options?: AccountEntriesOptions,
  ): Promise<AccountEntriesResult> {
    const paddedAccountId = accountId.padStart(8, "0");
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
        IndexName: "GSI1", // Ajusté pour correspondre à ton standard GSI1
        KeyConditionExpression: "GSI1PK = :pk AND begins_with(GSI1SK, :sk)",
        ExpressionAttributeValues: marshall({
          ":pk": KeyFactory.gsi1PK(orgId),
          ":sk": `ACC#${paddedAccountId}#FY#${fiscalYear}`,
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
}
