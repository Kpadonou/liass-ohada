import { handler as postEntry } from "../lambda/domains/core-ledger/entries/post-entry";
import { handler as getReport } from "../lambda/domains/projects/get-project-report";
import { dynamoClient } from "@/lambda/shared/dynamo-client";
import { PutItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { KeyFactory } from "@/lambda/shared/key-builder";
import { APIGatewayProxyEvent } from "aws-lambda";

async function runE2ETest() {
  const orgId = "org-test-dash";
  const projectId = "EDU-002";
  const year = 2026;

  console.log("🚀 DÉMARRAGE DU TEST E2E : COMPTABILITÉ + BUDGET");
  console.log("-----------------------------------------------");

  // --- ÉTAPE 0 : Injection des comptes comptables nécessaires ---
  console.log("0. Création des comptes 60510000 et 40110000...");
  const accounts = ["60510000", "40110000"];

  for (const accId of accounts) {
    await dynamoClient.send(
      new PutItemCommand({
        TableName: process.env.TABLE_NAME,
        Item: marshall({
          PK: KeyFactory.orgKey(orgId),
          SK: KeyFactory.accountSK(accId),
          entityType: "ACCOUNT",
          accountId: accId,
          label: accId === "60510000" ? "Fournitures" : "Fournisseurs",
          orgId,
        }),
      }),
    );
  }
  // --- ÉTAPE 1 : Création d'une ligne budgétaire (Le Prévu) ---
  console.log("1. Injection d'une ligne budgétaire de 2,000,000 XOF...");
  await dynamoClient.send(
    new PutItemCommand({
      TableName: process.env.TABLE_NAME,
      Item: marshall({
        PK: KeyFactory.orgKey(orgId),
        SK: KeyFactory.budgetLineSK(projectId, year.toString(), "EQUIP-01"),
        entityType: "BUDGET_LINE",
        projectId: projectId, // ✨ AJOUTÉ
        fiscalYear: year.toString(), // ✨ AJOUTÉ (en string)
        code: "EQUIP-01",
        label: "Matériel Informatique",
        amount: 10000000,
        category: "EQUIPMENT", // ✨ CORRIGÉ (Vérifie bien l'orthographe attendue par ton schéma)
      }),
    }),
  );

  // --- ÉTAPE 2 : Saisie d'une écriture comptable (Le Réel) ---
  console.log("2. Envoi d'une écriture de 800,000 XOF via le Post-Entry...");
  const entryPayload = {
    orgId, // Ajout explicite
    year,
    entryDate: "2026-03-14", // Format YYYY-MM-DD exigé par ta Regex
    label: "Achat de 2 Laptops",
    accountingStandard: "SYCEBNL", // Pour être cohérent avec ton projet
    journalCode: "HA",
    lines: [
      {
        accountId: "60510000", // 8 chiffres exactement
        debit: 100000,
        credit: 0, // Strictement 0 pour passer le .refine()
        projectId,
        budgetLineId: "EQUIP-01",
        label: "Laptop Pro",
      },
      {
        accountId: "40110000", // 8 chiffres exactement
        debit: 0, // Strictement 0
        credit: 100000,
        label: "Fournisseur Dell",
      },
    ],
  };

  const postEvent = {
    body: JSON.stringify(entryPayload),
    requestContext: { authorizer: { claims: { orgId } } },
    headers: { "Accept-Language": "fr" },
  } as unknown as APIGatewayProxyEvent;

  const postResult = await postEntry(postEvent);
  if (postResult.statusCode !== 201) {
    console.error("❌ Échec de la saisie :", postResult.body);
    return;
  }
  console.log("✅ Écriture comptable enregistrée !");

  // --- ÉTAPE 3 : Vérification dans le rapport TER ---
  console.log("3. Génération du rapport analytique...");
  const reportEvent = {
    pathParameters: { projectId },
    queryStringParameters: { year: year.toString() },
    requestContext: { authorizer: { claims: { orgId } } },
    headers: { "Accept-Language": "fr" },
  } as unknown as APIGatewayProxyEvent;

  const reportResult = await getReport(reportEvent);
  const reportData = JSON.parse(reportResult.body).data;

  // --- ÉTAPE 4 : Analyse du résultat ---
  const line = reportData.budgetVsActual.find(
    (b: any) => b.code === "EQUIP-01",
  );

  console.log("\n🎯 RÉSULTAT DU TEST :");
  if (line && line.spent === 800000) {
    console.log("✅ SUCCÈS : Le budget a été consommé de 800,000 XOF.");
    console.log(`📊 Taux d'exécution : ${line.executionRate}%`);
    console.log(`💰 Reste à dépenser : ${line.remaining.toLocaleString()} XOF`);
  } else {
    console.error("❌ ÉCHEC : La dépense n'apparaît pas dans le budget.");
    console.dir(line);
  }
}

runE2ETest().catch(console.error);
