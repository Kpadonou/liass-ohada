import { handler as postEntry } from "../lambda/domains/core-ledger/entries/post-entry";
import { dynamoClient } from "@/lambda/shared/dynamo-client";
import { PutItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { KeyFactory } from "@/lambda/shared/key-builder";
import { handler as getReport } from "../lambda/domains/projects/get-project-report";

async function runMultiDonorTest() {
  const orgId = "org-test-dash";
  const projectId = "PRJ-SUCCESS-AX";
  const year = 2026;

  console.log("🚀 TEST MULTI-BAILLEUR : UNICEF vs BANQUE MONDIALE");
  console.log("--------------------------------------------------");

  // 1. Initialisation : Comptes, Projet et Budget
  await setupEnvironment(orgId, projectId, year);

  // --- 1. CRÉER L'ITEM PROJET (Version complète pour Zod) ---
  const now = new Date().toISOString();
  await dynamoClient.send(
    new PutItemCommand({
      TableName: process.env.TABLE_NAME,
      Item: marshall({
        PK: KeyFactory.orgKey(orgId),
        SK: KeyFactory.projectSK(projectId), // Utilise la KeyFactory !
        entityType: "PROJECT",
        projectId: projectId,
        projectCode: "PRJ-001", // ✨ Manquait
        name: "Projet Test Multi-Bailleur",
        status: "ACTIVE",
        donorId: "MULTI", // ✨ Manquait
        managerId: "USR-001", // ✨ Manquait
        startDate: "2026-01-01", // ✨ Manquait
        totalBudget: 7000000, // ✨ Manquait (5M UNICEF + 2M WB)
        orgId: orgId,
        createdAt: now, // ✨ Manquait
        updatedAt: now, // ✨ Manquait
      }),
    }),
  );

  // --- SCÉNARIO 1 : Dépense excessive sur la Banque Mondiale ---
  console.log(
    "\n1️⃣ Tentative : 3 000 000 XOF sur Banque Mondiale (Budget: 2M)...",
  );
  const resWB = await sendEntry(orgId, projectId, "WB", 3000000);

  if (resWB.statusCode === 400) {
    console.log(
      "✅ SUCCÈS : La saisie a été REJETÉE (Dépassement bailleur détecté).",
    );
  } else {
    console.error("❌ ÉCHEC : La saisie a été acceptée indûment !");
  }

  // --- SCÉNARIO 2 : Même dépense sur l'UNICEF ---
  console.log("\n2️⃣ Tentative : 3 000 000 XOF sur UNICEF (Budget: 5M)...");
  const resUnicef = await sendEntry(orgId, projectId, "UNICEF", 3000000);

  if (resUnicef.statusCode === 201) {
    console.log(
      "✅ SUCCÈS : La saisie a été ACCEPTÉE (Budget UNICEF suffisant).",
    );
  } else {
    console.error(
      "❌ ÉCHEC : L'UNICEF devrait avoir assez de fonds.",
      resUnicef.body,
    );
  }

  // --- ÉTAPE 3 : Vérification du rapport croisé ---
  console.log("\n3️⃣ Génération du rapport analytique multi-bailleur...");
  const reportRes = await getReport({
    pathParameters: { projectId },
    queryStringParameters: { year: year.toString() },
    requestContext: { authorizer: { claims: { orgId } } },
    headers: { "Accept-Language": "fr" },
  } as any);

  const data = JSON.parse(reportRes.body).data;
  const line = data.budgetVsActual[0];

  console.log("\n🎯 RÉSULTAT DU RAPPORT :");
  console.table({
    Ligne: line.label,
    "Budget Total": line.allocated,
    "Dépense UNICEF": line.donors.UNICEF,
    "Dépense WB": line.donors.WB,
    "Hors-Bailleur": line.unallocated,
    "Total Réel": line.spent,
    "Taux Exécution": `${line.executionRate}%`,
  });

  // Vérification logique
  if (line.donors.UNICEF === 3000000 && line.donors.WB === 0) {
    console.log("\n✅ RÉUSSITE : La ventilation par bailleur est exacte !");
  } else {
    console.error("\n❌ ERREUR : La ventilation est incorrecte.");
  }
}

// --- Fonctions Helpers ---

async function sendEntry(
  orgId: string,
  projectId: string,
  donorId: string,
  amount: number,
) {
  const payload = {
    year: 2026,
    entryDate: "2026-03-15",
    label: `Dépense test ${donorId}`,
    journalCode: "HA",
    lines: [
      {
        accountId: "60510000",
        debit: amount,
        credit: 0,
        projectId,
        budgetLineId: "EQUIP-01",
        donorId: donorId, // Le pivot de notre test
        label: "Achat matériel",
      },
      {
        accountId: "40110000",
        debit: 0,
        credit: amount,
        label: "Fournisseur",
      },
    ],
  };

  return await postEntry({
    body: JSON.stringify(payload),
    requestContext: { authorizer: { claims: { orgId } } },
    headers: { "Accept-Language": "fr" },
  } as any);
}

async function setupEnvironment(
  orgId: string,
  projectId: string,
  year: number,
) {
  // Créer Ligne Budgétaire (10M total pour le matériel)
  await dynamoClient.send(
    new PutItemCommand({
      TableName: process.env.TABLE_NAME,
      Item: marshall({
        PK: KeyFactory.orgKey(orgId),
        SK: KeyFactory.budgetLineSK(projectId, year.toString(), "EQUIP-01"),
        entityType: "BUDGET_LINE",
        projectId,
        fiscalYear: year.toString(),
        code: "EQUIP-01",
        label: "Matériel Informatique",
        amount: 10000000,
        category: "EQUIPMENT",
      }),
    }),
  );

  // Créer Bailleur WB (2M)
  await dynamoClient.send(
    new PutItemCommand({
      TableName: process.env.TABLE_NAME,
      Item: marshall({
        PK: KeyFactory.orgKey(orgId),
        SK: KeyFactory.fundingSourceSK(projectId, "WB"),
        entityType: "FUNDING_SOURCE",
        projectId,
        donorId: "WB",
        amount: 2000000,
      }),
    }),
  );

  // Créer Bailleur UNICEF (5M)
  await dynamoClient.send(
    new PutItemCommand({
      TableName: process.env.TABLE_NAME,
      Item: marshall({
        PK: KeyFactory.orgKey(orgId),
        SK: KeyFactory.fundingSourceSK(projectId, "UNICEF"),
        entityType: "FUNDING_SOURCE",
        projectId,
        donorId: "UNICEF",
        amount: 5000000,
      }),
    }),
  );

  // (Ajouter ici les comptes 60510000 et 40110000 si nécessaire)
}

runMultiDonorTest().catch(console.error);
