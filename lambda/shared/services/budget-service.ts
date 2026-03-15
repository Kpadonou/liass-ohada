import { GetItemCommand, QueryCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { dynamoClient } from "../dynamo-client";
import { config } from "../config";
import { KeyFactory } from "../key-builder";

/**
 * @class BudgetService
 * @description Provides validation logic for project-based expenditures.
 * Implements a "Double-Lock" validation strategy:
 * 1. Global Line Check: Ensures the total budget for an activity (e.g., Equipment) isn't exceeded.
 * 2. Donor Cap Check: Ensures the specific donor's contribution limit isn't exceeded.
 */
export class BudgetService {
  /**
   * Vérifie la disponibilité budgétaire globale ET par bailleur.
   */
  static async getAvailableBudget(
    orgId: string,
    projectId: string,
    budgetLineId: string,
    year: number,
    donorId?: string, // ✨ Nouveau : Identification du bailleur
  ) {
    // 1. Récupérer la ligne budgétaire (Le "Quoi" : ex. Matériel)
    const budgetRes = await dynamoClient.send(
      new GetItemCommand({
        TableName: config.TABLE_NAME,
        Key: marshall({
          PK: KeyFactory.orgKey(orgId),
          SK: KeyFactory.budgetLineSK(projectId, year.toString(), budgetLineId),
        }),
      }),
    );

    if (!budgetRes.Item) return null;
    const budgetLine = unmarshall(budgetRes.Item);

    // 2. Si un bailleur est spécifié, vérifier son enveloppe (Le "Qui")
    let donorLimit = Infinity;
    if (donorId) {
      const donorRes = await dynamoClient.send(
        new GetItemCommand({
          TableName: config.TABLE_NAME,
          Key: marshall({
            PK: KeyFactory.orgKey(orgId),
            SK: KeyFactory.fundingSourceSK(projectId, donorId), // PRJ#ID#FS#DONOR
          }),
        }),
      );

      if (donorRes.Item) {
        donorLimit = unmarshall(donorRes.Item).amount;
      }
    }

    // 3. Récupérer TOUTES les transactions du projet pour l'année
    const transactions = await dynamoClient.send(
      new QueryCommand({
        TableName: config.TABLE_NAME,
        IndexName: "GSI_PROJECT",
        KeyConditionExpression: "GSI4PK = :pk AND begins_with(GSI4SK, :sk)",
        ExpressionAttributeValues: marshall({
          ":pk": KeyFactory.gsi4PK(orgId),
          ":sk": KeyFactory.projectYearPrefix(projectId, year),
        }),
      }),
    );

    const allItems = (transactions.Items || []).map((i) => unmarshall(i));

    // 4. CALCULS DES CONSOMMATIONS
    // A. Consommation totale de la ligne budgétaire (tous bailleurs confondus)
    const spentOnLine = allItems
      .filter((t) => t.budgetLineId === budgetLineId)
      .reduce((sum, t) => sum + (t.debit || 0), 0);

    // B. Consommation totale du bailleur sur ce projet
    const spentByDonor = donorId
      ? allItems
          .filter((t) => t.donorId === donorId)
          .reduce((sum, t) => sum + (t.debit || 0), 0)
      : 0;

    // 5. RÉSULTAT DOUBLE CONTRÔLE
    const availableOnLine = budgetLine.amount - spentOnLine;
    const availableForDonor = donorLimit - spentByDonor;

    return {
      budgetLine: {
        allocated: budgetLine.amount,
        spent: spentOnLine,
        available: availableOnLine,
      },
      donor: donorId
        ? {
            id: donorId,
            allocated: donorLimit,
            spent: spentByDonor,
            available: availableForDonor,
          }
        : null,
      // La dépense est possible seulement si les DEUX soldes sont positifs
      canSpend: (amount: number) =>
        amount <= availableOnLine && amount <= availableForDonor,
    };
  }
}
