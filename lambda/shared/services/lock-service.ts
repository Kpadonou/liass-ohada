/**
 * @class LockService
 * @description Centralizes the logic for accounting period locks.
 * It ensures that no write operations (creation, lettering, reversal)
 * occur within a month that has been officially closed/locked by the organization.
 */
import { GetItemCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall, marshall } from "@aws-sdk/util-dynamodb";
import { dynamoClient } from "../dynamo-client";
import { config } from "../config";
import { KeyFactory } from "../key-builder";

export class LockService {
  /**
   * @async
   * @method isPeriodLocked
   * @description Checks DynamoDB for a 'PERIOD_LOCK' item matching the date's year and month.
   * @param {string} orgId - Organization ID.
   * @param {string} date - Date string in ISO or YYYY-MM-DD format.
   * @returns {Promise<boolean>} - Returns true if the status is explicitly 'LOCKED'.
   */
  static async isPeriodLocked(orgId: string, date: string): Promise<boolean> {
    const d = new Date(date);
    const year = d.getFullYear();
    const month = (d.getMonth() + 1).toString().padStart(2, "0");

    const result = await dynamoClient.send(
      new GetItemCommand({
        TableName: config.TABLE_NAME,
        Key: marshall({
          PK: KeyFactory.partitionKey(orgId, year),
          SK: KeyFactory.periodLockSK(month),
        }),
      }),
    );

    if (!result.Item) return false;

    const lock = unmarshall(result.Item);
    return lock.status === "LOCKED";
  }
}
