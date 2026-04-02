import { GetItemCommand, QueryCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { config } from "../config";
import { dynamoClient } from "../dynamo-client";
import { KeyFactory } from "../key-builder";

/**
 * Represent an aggregated balance for a specific account and fiscal year.
 */
export interface AccountBalance {
  accountId: string;
  openingDebit: number;
  openingCredit: number;
  movementDebit: number;
  movementCredit: number;
  updatedAt: string;
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
  ): any {
    const isOpening = journalCode === "RAN";

    // On choisit dynamiquement les champs à incrémenter
    const debitField = isOpening ? "openingDebit" : "movementDebit";
    const creditField = isOpening ? "openingCredit" : "movementCredit";

    return {
      Update: {
        TableName: config.TABLE_NAME,
        Key: marshall({
          PK: KeyFactory.partitionKey(orgId, year),
          SK: `BAL#${accountId.padEnd(8, "0")}`,
        }),
        // Utilisation de variables pour les noms de champs
        UpdateExpression: `ADD #d :d, #c :c SET updatedAt = :now, entityType = :type, orgId = :orgId, accountId = :accId, #yr = :year`,
        ExpressionAttributeNames: {
          "#d": debitField,
          "#c": creditField,
          "#yr": "year",
        },
        ExpressionAttributeValues: marshall({
          ":d": debit,
          ":c": credit,
          ":now": new Date().toISOString(),
          ":type": "ACCOUNT_BALANCE",
          ":orgId": orgId,
          ":accId": accountId.padEnd(8, "0"),
          ":year": year,
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
          SK: `BAL#${paddedAccountId}`,
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
        updatedAt: new Date().toISOString(),
      } as AccountBalance;
    }

    const data = unmarshall(result.Item);

    return {
      accountId: data.accountId,
      openingDebit: data.openingDebit || 0,
      openingCredit: data.openingCredit || 0,
      movementDebit: data.movementDebit || 0,
      movementCredit: data.movementCredit || 0,
      updatedAt: data.updatedAt,
    };
  }

  /**
   * @async
   * @method getTrialBalance
   * @description Efficiently retrieves all account balances for a fiscal year.
   * Scans the main partition using the 'BAL#' prefix.
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
            ":skPrefix": "BAL#",
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
            updatedAt: data.updatedAt,
          });
        }
      }
      exclusiveStartKey = result.LastEvaluatedKey;
    } while (exclusiveStartKey);

    return balances;
  }
}
