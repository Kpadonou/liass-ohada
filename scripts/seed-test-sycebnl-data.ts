import { PutItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { dynamoClient } from "../lambda/shared/dynamo-client";
import { config } from "../lambda/shared/config";
import { KeyFactory } from "../lambda/shared/key-builder";

/**
 * Prépare les données de base dans LocalStack pour le test de flux projet.
 */
async function seed() {
  const orgId = "org-test-sycebnl";
  const now = new Date().toISOString();

  const items = [
    // 1. Année Fiscale 2026
    {
      PK: KeyFactory.orgKey(orgId),
      SK: KeyFactory.fiscalYearSK(2026),
      orgId: orgId,
      fiscalYearId: `FY-2026-${orgId}`,
      year: 2026,
      startDate: "2026-01-01",
      endDate: "2026-12-31",
      status: "OPEN",
      accountingStandard: "SYCEBNL", // Doit être une des valeurs de ton enum
      entityType: "FISCAL_YEAR",
      createdAt: now,
      updatedAt: now,
    },
    // 2. Compte de Charge (Loyer)
    {
      PK: KeyFactory.orgKey(orgId),
      SK: KeyFactory.accountSK("62210000"),
      accountId: "62210000",
      name: "Locations immobilières",
      entityType: "ACCOUNT",
    },
    // 3. Compte de Trésorerie (Banque)
    {
      PK: KeyFactory.orgKey(orgId),
      SK: KeyFactory.accountSK("52110000"),
      accountId: "52110000",
      name: "Banque BOA",
      entityType: "ACCOUNT",
    },
    {
      PK: KeyFactory.orgKey(orgId),
      SK: KeyFactory.accountSK("70110000"),
      accountId: "70110000",
      name: "Subventions d'exploitation",
      entityType: "ACCOUNT",
    },
    // 4. Le Projet WASH
    {
      PK: KeyFactory.orgKey(orgId),
      SK: KeyFactory.projectSK("PRJ-2026-WASH-001"),
      orgId: orgId,
      projectId: "PRJ-2026-WASH-001",
      projectCode: "WASH-2026",
      name: "Projet Eau et Assainissement",
      donorId: "DONOR-001",
      managerId: "MGR-001",
      startDate: "2026-01-01",
      budget: 5000000,
      currency: "XOF",
      entityType: "PROJECT",
      status: "ACTIVE",
      createdAt: now,
      updatedAt: now,
    },
  ];

  console.log("--- Seeding des données dans LocalStack ---");

  for (const item of items) {
    await dynamoClient.send(
      new PutItemCommand({
        TableName: config.TABLE_NAME,
        Item: marshall(item),
      }),
    );
    console.log(`✅ Injecté: ${item.SK}`);
  }
}

seed().catch(console.error);
