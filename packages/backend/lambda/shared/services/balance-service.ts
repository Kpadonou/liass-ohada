import {
  BatchGetItemCommand,
  GetItemCommand,
  QueryCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import {
  AccountBalanceDto,
  AccountBalanceDtoSchema,
} from "@liass-ohada/shared/accounting";
import { config } from "../config";
import { dynamoClient } from "../dynamo-client";
import { KeyFactory } from "../key-builder";
import { AppError } from "../middleware/handler-wrapper";

/**
 * Represent an aggregated balance for a specific account and fiscal year.
 */
export interface AccountBalance {
  accountId: string;
  openingDebit: number;
  openingCredit: number;
  movementDebit: number;
  movementCredit: number;
  dailyMovements: Record<string, { debit: number; credit: number }>;
  updatedAt?: string;
}

/**
 * @class BalanceService
 * @description Manages pre-aggregated account balances to ensure high performance
 * and low RCU consumption when generating financial reports.
 */
export class BalanceService {
  /**
   * @method buildBalanceUpdateAction
   * @description prepares a TransactWriteItem to atomically update an account balance.
   * This is returned to be bundled within a larger transaction (e.g., in post-entry).
   */
  static buildBalanceUpdateAction(
    orgId: string,
    year: string | number,
    accountId: string,
    debit: number,
    credit: number,
    journalCode: string,
    userId: string,
    entryDate: string,
  ): any {
    const isOpening = journalCode === "RAN";

    // On choisit dynamiquement les champs à incrémenter
    const debitField = isOpening ? "openingDebit" : "movementDebit";
    const creditField = isOpening ? "openingCredit" : "movementCredit";

    const dailyDebitField = `dailyDebit_${entryDate.replaceAll("-", "_")}`;
    const dailyCreditField = `dailyCredit_${entryDate.replaceAll("-", "_")}`;
    const updateExpression = isOpening
      ? "ADD #d :d, #c :c SET updatedAt = :now, createdAt = if_not_exists(createdAt, :now), createdBy = if_not_exists(createdBy, :userId), updatedBy = :userId, entityType = :type, orgId = :orgId, accountId = :accId, #yr = :year"
      : "ADD #d :d, #c :c, #dailyDebit :d, #dailyCredit :c SET updatedAt = :now, createdAt = if_not_exists(createdAt, :now), createdBy = if_not_exists(createdBy, :userId), updatedBy = :userId, entityType = :type, orgId = :orgId, accountId = :accId, #yr = :year";

    return {
      Update: {
        TableName: config.TABLE_NAME,
        Key: marshall({
          PK: KeyFactory.partitionKey(orgId, year),
          SK: KeyFactory.accountBalanceSK(accountId),
        }),
        // Utilisation de variables pour les noms de champs
        UpdateExpression: updateExpression,
        ExpressionAttributeNames: {
          "#d": debitField,
          "#c": creditField,
          "#yr": "year",
          ...(!isOpening
            ? {
                "#dailyDebit": dailyDebitField,
                "#dailyCredit": dailyCreditField,
              }
            : {}),
        },
        ExpressionAttributeValues: marshall({
          ":d": debit,
          ":c": credit,
          ":now": new Date().toISOString(),
          ":type": "ACCOUNT_BALANCE",
          ":orgId": orgId,
          ":accId": accountId.padEnd(8, "0"),
          ":year": year,
          ":userId": userId,
        }),
      },
    };
  }

  /**
   * @async
   * @method getAccountBalance
   * @description Retrieves the pre-calculated balance for a single account.
   */
  static async getAccountBalance(
    orgId: string,
    year: string | number,
    accountId: string,
  ): Promise<AccountBalance> {
    const paddedAccountId = accountId.padEnd(8, "0");

    const result = await dynamoClient.send(
      new GetItemCommand({
        TableName: config.TABLE_NAME,
        Key: marshall({
          PK: KeyFactory.partitionKey(orgId, year),
          SK: KeyFactory.accountBalanceSK(paddedAccountId),
        }),
      }),
    );

    if (!result.Item) {
      return {
        accountId: paddedAccountId,
        openingDebit: 0,
        openingCredit: 0,
        movementDebit: 0,
        movementCredit: 0,
        dailyMovements: {},
        updatedAt: undefined,
      } as AccountBalance;
    }

    const data = unmarshall(result.Item);

    return {
      accountId: data.accountId,
      openingDebit: data.openingDebit || 0,
      openingCredit: data.openingCredit || 0,
      movementDebit: data.movementDebit || 0,
      movementCredit: data.movementCredit || 0,
      dailyMovements: BalanceService.readDailyMovements(data),
      updatedAt: data.updatedAt,
    };
  }

  /**
   * @async
   * @method getTrialBalance
   * @description Efficiently retrieves all account balances for a fiscal year.
   * Queries the fiscal-year partition using the BAL# sort-key prefix.
   */
  static async getTrialBalance(orgId: string, year: string | number) {
    const balances: AccountBalance[] = [];
    let exclusiveStartKey: any = undefined;

    do {
      const result = await dynamoClient.send(
        new QueryCommand({
          TableName: config.TABLE_NAME,
          KeyConditionExpression: "PK = :pk AND begins_with(SK, :skPrefix)",
          ExpressionAttributeValues: marshall({
            ":pk": KeyFactory.partitionKey(orgId, year),
            ":skPrefix": KeyFactory.accountBalancePrefix(),
          }),
          ExclusiveStartKey: exclusiveStartKey,
        }),
      );

      if (result.Items) {
        for (const item of result.Items) {
          const data = unmarshall(item);
          balances.push({
            accountId: data.accountId,
            openingDebit: data.openingDebit || 0,
            openingCredit: data.openingCredit || 0,
            movementDebit: data.movementDebit || 0,
            movementCredit: data.movementCredit || 0,
            dailyMovements: BalanceService.readDailyMovements(data),
            updatedAt: data.updatedAt,
          });
        }
      }
      exclusiveStartKey = result.LastEvaluatedKey;
    } while (exclusiveStartKey);

    return balances;
  }

  static async getAccountLabels(
    orgId: string,
    accountIds: string[],
  ): Promise<Map<string, string>> {
    const labels = new Map<string, string>();

    for (let offset = 0; offset < accountIds.length; offset += 100) {
      let keys = accountIds.slice(offset, offset + 100).map((accountId) =>
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
                ProjectionExpression: "accountId, accountName",
              },
            },
          }),
        );

        for (const item of result.Responses?.[config.TABLE_NAME] || []) {
          const account = unmarshall(item);
          if (account.accountId && account.accountName) {
            labels.set(account.accountId, account.accountName);
          }
        }

        keys = result.UnprocessedKeys?.[config.TABLE_NAME]?.Keys || [];
      } while (keys.length > 0);
    }

    return labels;
  }

  static assertPeriodDetailComplete(balance: AccountBalance): void {
    const dailyTotals = Object.values(balance.dailyMovements).reduce(
      (totals, movement) => ({
        debit: totals.debit + movement.debit,
        credit: totals.credit + movement.credit,
      }),
      { debit: 0, credit: 0 },
    );

    if (
      dailyTotals.debit !== balance.movementDebit ||
      dailyTotals.credit !== balance.movementCredit
    ) {
      throw new AppError(409, "ERROR_TRIAL_BALANCE_PERIOD_AGGREGATES_INCOMPLETE");
    }
  }

  static toDto(balance: AccountBalance): AccountBalanceDto {
    const finalNet =
      balance.openingDebit +
      balance.movementDebit -
      (balance.openingCredit + balance.movementCredit);

    return AccountBalanceDtoSchema.parse({
      ...balance,
      finalDebit: finalNet > 0 ? finalNet : 0,
      finalCredit: finalNet < 0 ? Math.abs(finalNet) : 0,
    });
  }

  private static readDailyMovements(
    data: Record<string, unknown>,
  ): Record<string, { debit: number; credit: number }> {
    const movements: Record<string, { debit: number; credit: number }> = {};

    for (const [attribute, value] of Object.entries(data)) {
      const match = attribute.match(/^daily(Debit|Credit)_(\d{4})_(\d{2})_(\d{2})$/);
      if (!match) {
        continue;
      }

      const date = `${match[2]}-${match[3]}-${match[4]}`;
      const movement = movements[date] ?? { debit: 0, credit: 0 };
      movement[match[1] === "Debit" ? "debit" : "credit"] = Number(value) || 0;
      movements[date] = movement;
    }

    return movements;
  }
}
