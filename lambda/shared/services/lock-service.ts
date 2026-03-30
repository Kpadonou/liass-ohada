/**
 * @class LockService
 * @description Centralizes the logic for accounting period locks.
 * It ensures that no write operations (creation, lettering, reversal)
 * occur within a month that has been officially closed/locked by the organization.
 */
import { GetItemCommand, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { config } from "../config";
import { dynamoClient } from "../dynamo-client";
import { KeyFactory } from "../key-builder";
import { AppError } from "../middleware/handler-wrapper";
import { LedgerService } from "./ledger-service";

export class LockService {
  /**
   * @async
   * @method isPeriodLocked
   * @description Checks if a period is locked using robust string parsing to avoid TZ shifts.
   * @param {string} orgId - Organization ID.
   * @param {string} date - Date string (YYYY-MM-DD or ISO).
   * @returns {Promise<boolean>}
   */
  static async isPeriodLocked(orgId: string, date: string): Promise<boolean> {
    // On extrait l'année et le mois directement de la chaîne "YYYY-MM-DD..."
    // Cela évite que '2026-04-01T00:00' ne devienne '2026-03-31' à cause d'un décalage UTC.
    const yearPart = date.substring(0, 4);
    const monthPart = date.substring(5, 7); // Récupère 'MM' de 'YYYY-MM-DD'

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

  /**
   * @async
   * @method updatePeriodLock
   * @description Lock or unlock a monthly period for a fiscal year.
   * Must prevent period lock updates when the parent fiscal year is CLOSED.
   * @param {string} orgId - Organization ID (from JWT claims)
   * @param {number} year - Fiscal year (e.g., 2026)
   * @param {number} month - Month number (1-12)
   * @param {'LOCKED'|'OPEN'} status - Target period status
   * @returns {Promise<object>} - Persisted period lock item
   */
  static async updatePeriodLock(
    orgId: string,
    year: number,
    month: number,
    status: "LOCKED" | "OPEN",
  ): Promise<Record<string, any>> {
    const fiscalYear = await LedgerService.getFiscalYear(orgId, year);
    if (fiscalYear.status === "CLOSED" || fiscalYear.status === "ARCHIVED") {
      throw new AppError(400, "ERROR_FISCAL_YEAR_LOCKED");
    }

    const normalizedMonth = month.toString().padStart(2, "0");
    const lockItem = {
      PK: KeyFactory.partitionKey(orgId, year),
      SK: KeyFactory.periodLockSK(normalizedMonth),
      orgId,
      year,
      month: normalizedMonth,
      status,
      entityType: "PERIOD_LOCK",
      updatedAt: new Date().toISOString(),
    };

    await dynamoClient.send(
      new PutItemCommand({
        TableName: config.TABLE_NAME,
        Item: marshall(lockItem),
        ConditionExpression:
          "attribute_not_exists(PK) OR #status <> :newStatus",
        ExpressionAttributeNames: {
          "#status": "status",
        },
        ExpressionAttributeValues: marshall({
          ":newStatus": status,
        }),
      }),
    );

    return lockItem;
  }
}
