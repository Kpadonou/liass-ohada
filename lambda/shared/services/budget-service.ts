import { GetItemCommand, QueryCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { dynamoClient } from "../dynamo-client";
import { config } from "../config";
import { KeyFactory } from "../key-builder";

export class BudgetService {
  /**
   * Vérifie si une dépense peut être effectuée sur une ligne budgétaire
   */
  static async getAvailableBudget(
    orgId: string,
    projectId: string,
    budgetLineId: string,
    year: number,
  ) {
    // 1. Récupérer l'enveloppe allouée
    const budgetRes = await dynamoClient.send(
      new GetItemCommand({
        TableName: config.TABLE_NAME,
        Key: marshall({
          PK: KeyFactory.orgKey(orgId),
          SK: KeyFactory.budgetLineSK(projectId, year.toString(), budgetLineId),
        }),
      }),
    );

    if (!budgetRes.Item) return null; // Pas de budget défini = Pas de contrôle
    const budgetLine = unmarshall(budgetRes.Item);

    // 2. Calculer le déjà consommé via GSI4
    const transactions = await dynamoClient.send(
      new QueryCommand({
        TableName: config.TABLE_NAME,
        IndexName: "GSI_PROJECT", // Ton index SYCEBNL
        KeyConditionExpression: "GSI4PK = :pk AND begins_with(GSI4SK, :sk)",
        ExpressionAttributeValues: marshall({
          ":pk": KeyFactory.gsi4PK(orgId),
          ":sk": KeyFactory.projectYearPrefix(projectId, year),
        }),
      }),
    );

    const spent = (transactions.Items || [])
      .map((item) => unmarshall(item))
      .filter((t) => t.budgetLineId === budgetLineId)
      .reduce((sum, t) => sum + (t.debit || 0), 0);

    return {
      allocated: budgetLine.amount,
      spent,
      available: budgetLine.amount - spent,
    };
  }
}
