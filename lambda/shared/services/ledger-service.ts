import { QueryCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { dynamoClient } from "../dynamo-client";
import { config } from "../config";

/**
 * Options for account entries query
 */
export interface AccountEntriesOptions {
  limit?: number;
  cursor?: string;
}

/**
 * Account entry result
 */
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
  // Add other fields as needed
}

/**
 * Paginated account entries result
 */
export interface AccountEntriesResult {
  entries: AccountEntry[];
  nextCursor?: string;
  hasMore: boolean;
}

/**
 * Get account entries for a specific fiscal year
 * @param orgId Organization ID
 * @param fiscalYear Fiscal year (e.g., "2024")
 * @param accountNumber Account number (e.g., "4111" - will be padded to 8 digits)
 * @param options Query options (limit, cursor for pagination)
 * @returns Paginated list of account entries sorted by date
 */
export async function getAccountEntries(
  orgId: string,
  fiscalYear: string,
  accountNumber: string,
  options: AccountEntriesOptions = {}
): Promise<AccountEntriesResult> {
  // Pad account number to 8 digits
  const paddedAccountNumber = accountNumber.padStart(8, "0");

  const { limit = 50, cursor } = options;

  // Parse cursor for pagination
  let exclusiveStartKey: any = undefined;
  if (cursor) {
    try {
      exclusiveStartKey = JSON.parse(Buffer.from(cursor, "base64").toString());
    } catch (error) {
      throw new Error("Invalid cursor format");
    }
  }

  // Query the GSI-Account to get all entries for this account in the fiscal year
  const queryResult = await dynamoClient.send(
    new QueryCommand({
      TableName: config.TABLE_NAME,
      IndexName: "GSI-Account",
      KeyConditionExpression: "PK = :pk AND begins_with(GSI1SK, :gsi1sk)",
      ExpressionAttributeValues: {
        ":pk": { S: `ORG#${orgId}#FY#${fiscalYear}` },
        ":gsi1sk": { S: `ACC#${paddedAccountNumber}` },
      },
      Limit: limit,
      ExclusiveStartKey: exclusiveStartKey,
      ScanIndexForward: true, // Sort by date ascending (date is in gsi1sk)
    })
  );

  const entries: AccountEntry[] = [];

  // Process the results
  if (queryResult.Items) {
    for (const item of queryResult.Items) {
      const unmarshalled = unmarshall(item);
      entries.push({
        entryId: unmarshalled.entryId,
        accountId: unmarshalled.accountId,
        debit: unmarshalled.debit || 0,
        credit: unmarshalled.credit || 0,
        description: unmarshalled.description,
        entryDate: unmarshalled.entryDate,
        voucherNumber: unmarshalled.voucherNumber,
        journalCode: unmarshalled.journalCode,
        thirdPartyId: unmarshalled.thirdPartyId,
        createdAt: unmarshalled.createdAt,
      });
    }
  }

  // Create next cursor if there are more results
  let nextCursor: string | undefined;
  if (queryResult.LastEvaluatedKey) {
    nextCursor = Buffer.from(
      JSON.stringify(queryResult.LastEvaluatedKey)
    ).toString("base64");
  }

  return {
    entries,
    nextCursor,
    hasMore: !!queryResult.LastEvaluatedKey,
  };
}
