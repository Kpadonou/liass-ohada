import { dynamoClient } from "@/lambda/shared/dynamo-client";
import { PutItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { KeyFactory } from "@/lambda/shared/key-builder";

const orgId = "org-test-dash";
const projectId = "EDU-002";
const year = "2026";

async function seedBudget() {
  console.log("📑 SEEDING BUDGET & LINES...");

  const budgetLines = [
    {
      code: "PERS-01",
      label: "Salaires Enseignants",
      amount: 5000000,
      category: "PERSONNEL",
    },
    {
      code: "EQUIP-01",
      label: "Fournitures Scolaires",
      amount: 2000000,
      category: "EQUIPMENT",
    },
    {
      code: "ACT-1.1",
      label: "Ateliers Pédagogiques",
      amount: 1000000,
      category: "ACTIVITY",
    },
  ];

  try {
    // 1. Création du Budget Header
    await dynamoClient.send(
      new PutItemCommand({
        TableName: process.env.TABLE_NAME,
        Item: marshall({
          PK: KeyFactory.orgKey(orgId),
          SK: KeyFactory.budgetSK(projectId, year),
          entityType: "BUDGET",
          projectId,
          fiscalYear: year,
          status: "APPROVED",
          totalAmount: 8000000, // Somme des lignes
          updatedAt: new Date().toISOString(),
        }),
      }),
    );

    // 2. Création des Lignes Budgétaires
    for (const line of budgetLines) {
      await dynamoClient.send(
        new PutItemCommand({
          TableName: process.env.TABLE_NAME,
          Item: marshall({
            PK: KeyFactory.orgKey(orgId),
            SK: KeyFactory.budgetLineSK(projectId, year, line.code),
            entityType: "BUDGET_LINE",
            projectId,
            fiscalYear: year,
            code: line.code,
            label: line.label,
            amount: line.amount,
            category: line.category,
          }),
        }),
      );
    }

    console.log("✅ Budget EDU-002 créé avec 3 lignes.");
  } catch (error) {
    console.error("❌ Seeding Budget Error:", error);
  }
}

seedBudget();
