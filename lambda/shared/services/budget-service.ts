import { GetItemCommand, QueryCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { dynamoClient } from "../dynamo-client";
import { config } from "../config";
import { KeyFactory } from "../key-builder";

export class BudgetService {
  /**
   * Centralise la récupération de toutes les transactions d'un projet pour une année.
   * Utilise l'index GSI4 (Vue Analytique).
   */
  private static async fetchProjectTransactions(
    orgId: string,
    projectId: string,
    year: number,
  ) {
    const result = await dynamoClient.send(
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
    return (result.Items || []).map((i) => unmarshall(i));
  }

  /**
   * Vérifie la disponibilité budgétaire ET la disponibilité du cash (Encaissements).
   */
  static async getAvailableBudget(
    orgId: string,
    projectId: string,
    budgetLineId: string,
    year: number,
    donorId?: string,
  ) {
    // 1. Récupérer la ligne budgétaire (Le Planifié)
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

    // 2. Récupérer le plafond du bailleur (La Promesse)
    let donorLimit = Infinity;
    if (donorId) {
      const donorRes = await dynamoClient.send(
        new GetItemCommand({
          TableName: config.TABLE_NAME,
          Key: marshall({
            PK: KeyFactory.orgKey(orgId),
            SK: KeyFactory.fundingSourceSK(projectId, donorId),
          }),
        }),
      );
      if (donorRes.Item) donorLimit = unmarshall(donorRes.Item).amount;
    }

    // 3. Récupérer le Réalisé (Transactions)
    const allItems = await this.fetchProjectTransactions(
      orgId,
      projectId,
      year,
    );

    // 4. CALCULS ANALYTIQUES
    // A. Dépenses sur la ligne spécifique (EQUIP-01, ACT-1, etc.)
    const spentOnLine = allItems
      .filter((t) => t.budgetLineId === budgetLineId)
      .reduce((sum, t) => sum + (t.debit || 0), 0);

    // B. Situation globale du Bailleur (Budget vs Cash vs Dépenses)
    let donorStats = null;
    if (donorId) {
      // Argent total versé par le bailleur (Crédits sur comptes de revenus/7xx)
      const totalReceived = allItems
        .filter((t) => t.donorId === donorId)
        .reduce((sum, t) => sum + (t.credit || 0), 0);

      // Argent total déjà dépensé par ce bailleur
      const totalSpentByDonor = allItems
        .filter((t) => t.donorId === donorId)
        .reduce((sum, t) => sum + (t.debit || 0), 0);

      donorStats = {
        id: donorId,
        contractAmount: donorLimit, // La promesse (ex: 5M)
        cashReceived: totalReceived, // Ce qu'on a en banque (ex: 2M)
        totalSpent: totalSpentByDonor, // Ce qu'on a déjà utilisé (ex: 500k)
        budgetAvailable: donorLimit - totalSpentByDonor, // 4.5M
        cashAvailable: totalReceived - totalSpentByDonor, // 1.5M (Le vrai juge)
      };
    }

    const availableOnLine = budgetLine.amount - spentOnLine;

    return {
      budgetLine: {
        code: budgetLineId,
        allocated: budgetLine.amount,
        spent: spentOnLine,
        available: availableOnLine,
      },
      donor: donorStats,
      /**
       * RÈGLE DE VALIDATION "TRIPLE LOCK" :
       * 1. Il reste du budget sur l'activité (EQUIP-01).
       * 2. Il reste du budget sur l'enveloppe du bailleur (UNICEF).
       * 3. Il y a assez de cash réel reçu pour payer (Trésorerie).
       */
      canSpend: (amount: number) => {
        const hasBudget = amount <= availableOnLine;
        const hasDonorBudget = donorStats
          ? amount <= donorStats.budgetAvailable
          : true;
        const hasCash = donorStats ? amount <= donorStats.cashAvailable : true;

        return hasBudget && hasDonorBudget && hasCash;
      },
    };
  }
}
