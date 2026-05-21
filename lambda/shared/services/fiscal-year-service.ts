import { config } from "@/lambda/shared/config";
import { dynamoClient } from "@/lambda/shared/dynamo-client";
import { KeyFactory } from "@/lambda/shared/key-builder";
import { AppError } from "@/lambda/shared/middleware/handler-wrapper";
import { GetItemCommand, QueryCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { BalanceService } from "./balance-service";
import { ClosingService } from "./closing-service";
import { LedgerService } from "./ledger-service";
import { LockPeriodService } from "./lock-period-service";

export class FiscalYearService {
  /**
   * Returns the tenant-scoped fiscal year state with its monthly period locks.
   * Reads only the organization master fiscal-year item and the matching FY
   * partition, preserving fiscal-year sharding.
   */
  static async getDetails(orgId: string, year: string) {
    const fiscalYearResult = await dynamoClient.send(
      new GetItemCommand({
        TableName: config.TABLE_NAME,
        Key: marshall({
          PK: KeyFactory.orgKey(orgId),
          SK: KeyFactory.fiscalYearSK(year),
        }),
      }),
    );

    if (!fiscalYearResult.Item) {
      throw new AppError(404, "ERROR_FISCAL_YEAR_NOT_FOUND");
    }

    const locksResult = await dynamoClient.send(
      new QueryCommand({
        TableName: config.TABLE_NAME,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
        ExpressionAttributeValues: marshall({
          ":pk": KeyFactory.partitionKey(orgId, year),
          ":sk": "LOCK#PERIOD#",
        }),
      }),
    );

    const locks = (locksResult.Items || []).map((item) => unmarshall(item));

    return {
      ...unmarshall(fiscalYearResult.Item),
      periodLocks: locks.reduce(
        (acc, lock) => {
          const monthKey = lock.month || String(lock.SK).split("#").pop();
          acc[monthKey] = lock.status;
          return acc;
        },
        {} as Record<string, string>,
      ),
    };
  }

  /**
   * Executes year-end closing only for an OPEN fiscal year with management
   * account movements. Delegates the atomic closing entry and fiscal-year status
   * update to ClosingService while preserving the calling user for audit fields.
   */
  static async closeYear(orgId: string, userId: string, year: string) {
    const fiscalYear = await LedgerService.getFiscalYear(orgId, year);

    if (fiscalYear.status !== "OPEN") {
      throw new AppError(400, "ERROR_FISCAL_YEAR_LOCKED");
    }

    const allBalances = await BalanceService.getTrialBalance(orgId, year);
    const managementBalances = allBalances.filter(
      (balance) =>
        balance.accountId.startsWith("6") || balance.accountId.startsWith("7"),
    );

    if (managementBalances.length === 0) {
      throw new AppError(400, "ERROR_NO_MOVEMENTS_FOUND");
    }

    return ClosingService.executeYearEnd(orgId, {
      year,
      userId,
      balances: managementBalances,
    });
  }

  /**
   * Locks or unlocks a fiscal period through LockPeriodService.
   * The service validates the parent fiscal year and stamps user audit metadata
   * so posting and lettering flows can enforce period immutability.
   */
  static async updatePeriodLock(
    orgId: string,
    userId: string,
    year: number,
    month: number,
    status: "LOCKED" | "OPEN",
  ) {
    return LockPeriodService.updatePeriodLock(orgId, userId, year, month, status);
  }
}
