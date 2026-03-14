import { dynamoClient } from "@/lambda/shared/dynamo-client";
import { PutItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { KeyFactory } from "@/lambda/shared/key-builder";

const orgId = "org-test-dash";
const projectId = "EDU-002";
const year = "2026";

async function run() {
  console.log("🚀 SYNC BUDGET + TRANSACTIONS...");

  // 1. On injecte une ligne budgétaire "EQUIP-01" (Achat fournitures)
  await dynamoClient.send(
    new PutItemCommand({
      TableName: process.env.TABLE_NAME,
      Item: marshall({
        PK: KeyFactory.orgKey(orgId),
        SK: KeyFactory.budgetLineSK(projectId, year, "EQUIP-01"),
        entityType: "BUDGET_LINE",
        code: "EQUIP-01",
        amount: 2000000, // Budget prévu
        label: "Fournitures Scolaires",
      }),
    }),
  );

  // 2. On injecte une dépense réelle liée à ce code "EQUIP-01"
  // Note: On utilise GSI4 pour que ça remonte dans le Dashboard/TER
  await dynamoClient.send(
    new PutItemCommand({
      TableName: process.env.TABLE_NAME,
      Item: marshall({
        PK: KeyFactory.partitionKey(orgId, year), // PK comptable
        SK: KeyFactory.entryLineSK("L-001"),
        GSI4PK: KeyFactory.gsi4PK(orgId),
        GSI4SK: KeyFactory.gsi4SK(projectId, year, "2026-03-14", "L-001"),

        entityType: "ENTRY_LINE",
        accountId: "60510000",
        debit: 1500000, // Dépense réelle
        credit: 0,
        budgetLineId: "EQUIP-01", // LE PONT EST ICI
        fiscalYear: year,
      }),
    }),
  );

  console.log("✅ Données liées créées !");
}

run();
