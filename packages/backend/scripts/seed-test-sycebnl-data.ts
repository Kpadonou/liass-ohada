import { PutItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { dynamoClient } from "@/lambda/shared/dynamo-client";
import { config } from "@/lambda/shared/config";
import { KeyFactory } from "@/lambda/shared/key-builder";

async function seedProjectData() {
  const orgId = "org-test-sycebnl";
  const now = new Date().toISOString();

  const items = [
    // 1. Le Projet avec la nouvelle structure hybride
    {
      PK: KeyFactory.orgKey(orgId),
      SK: KeyFactory.projectSK("PRJ-2026-WASH-001"),
      orgId: orgId,
      projectId: "PRJ-2026-WASH-001",
      projectCode: "WASH-2026",
      name: "Projet Eau et Assainissement (Hybride)",
      donorId: "UNICEF",
      managerId: "MGR-BENIN-01",
      startDate: "2025-01-01",
      endDate: "2027-12-31",
      // Nouvelle structure budgétaire
      totalBudget: 15000000,
      annualBudgets: {
        "2025": 4000000,
        "2026": 6000000,
        "2027": 5000000,
      },
      currency: "XOF",
      entityType: "PROJECT",
      status: "ACTIVE",
      createdAt: now,
      updatedAt: now,
    },
    // 2. Compte de ressources (Subventions)
    {
      PK: KeyFactory.orgKey(orgId),
      SK: KeyFactory.accountSK("70110000"),
      accountId: "70110000",
      name: "Subventions d'exploitation",
      entityType: "ACCOUNT",
    },
  ];

  console.log("--- Seeding du Projet Hybride ---");
  for (const item of items) {
    await dynamoClient.send(
      new PutItemCommand({
        TableName: config.TABLE_NAME,
        Item: marshall(item),
      }),
    );
    console.log(`✅ Injecté : ${item.SK}`);
  }
}

seedProjectData().catch(console.error);
