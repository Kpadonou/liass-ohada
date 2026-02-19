process.env.TABLE_NAME = "liass-ohada-dev-accounting-table";
process.env.LOCALSTACK_URL = "http://localhost:4566";

import { handler as postEntry } from "../lambda/domains/core-ledger/entries/post-entry";
import { handler as getUnlettered } from "../lambda/domains/core-ledger/lettering/get-unlettered-lines";
import { handler as postLettering } from "../lambda/domains/core-ledger/lettering/post-lettering";
import { handler as cancelLettering } from "../lambda/domains/core-ledger/lettering/cancel-lettering";
import { PutItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { dynamoClient } from "../lambda/shared/dynamo-client";
import { KeyFactory } from "../lambda/shared/key-builder";

const ORG_ID = "test-org-sycebnl";
const YEAR = 2026;

/** Utility to wait for LocalStack GSI indexing */
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function setupSycebnlData() {
  const now = new Date().toISOString();
  console.log("🏗️ Configuration des Master Data SYCEBNL...");

  // 1. Config de l'Organisation en mode SYCEBNL
  await dynamoClient.send(
    new PutItemCommand({
      TableName: process.env.TABLE_NAME!,
      Item: marshall({
        PK: KeyFactory.orgKey(ORG_ID),
        SK: KeyFactory.orgKey(ORG_ID),
        orgId: ORG_ID,
        accountingStandard: "SYCEBNL",
        entityType: "ORGANIZATION",
        updatedAt: now,
      }),
    }),
  );

  // 2. Création des comptes (Tiers et Produit)
  const accounts = ["41110000", "75100000", "52100000"];
  for (const acc of accounts) {
    await dynamoClient.send(
      new PutItemCommand({
        TableName: process.env.TABLE_NAME!,
        Item: marshall({
          PK: KeyFactory.orgKey(ORG_ID),
          SK: KeyFactory.accountSK(acc),
          accountId: acc,
          isThirdPartyAccount: acc.startsWith("4"),
          updatedAt: now,
        }),
      }),
    );
  }
  console.log("✅ Master Data configurées.");
}

async function runSycebnlTests() {
  console.log("\n🚀 DÉMARRAGE DES TESTS DE LETTRAGE PROJET (SYCEBNL)");

  const commonContext = {
    requestContext: { authorizer: { claims: { orgId: ORG_ID } } },
    headers: { "Accept-Language": "fr" },
  };

  // --- ETAPE 1 : Création d'écritures ---
  console.log("\n--- 1️⃣ Création des écritures (Projet A et Projet B) ---");

  await postEntry({
    ...commonContext,
    body: JSON.stringify({
      year: YEAR,
      entryDate: "2026-02-15",
      label: "Facture Projet A",
      lines: [
        {
          accountId: "41110000",
          thirdPartyId: "DONOR-001",
          projectId: "PROJ-A",
          debit: 1000,
          credit: 0,
        },
        { accountId: "75100000", debit: 0, credit: 1000 },
      ],
    }),
  } as any);

  await postEntry({
    ...commonContext,
    body: JSON.stringify({
      year: YEAR,
      entryDate: "2026-02-16",
      label: "Paiement reçu Projet B",
      lines: [
        { accountId: "52100000", debit: 1000, credit: 0 },
        {
          accountId: "41110000",
          thirdPartyId: "DONOR-001",
          projectId: "PROJ-B",
          debit: 0,
          credit: 1000,
        },
      ],
    }),
  } as any);

  console.log("⏳ Attente de l'indexation GSI...");
  await sleep(1500);

  // --- ETAPE 2 : Test de la sécurité ---
  console.log(
    "\n--- 2️⃣ Test de sécurité : Tentative de lettrage inter-projets ---",
  );

  const resSugg = await getUnlettered({
    ...commonContext,
    queryStringParameters: {
      orgId: ORG_ID,
      accountId: "41110000",
      thirdPartyId: "DONOR-001",
    },
  } as any);

  const suggBody = JSON.parse(resSugg.body);
  const unletteredLines = suggBody.data?.unletteredLines || [];

  if (unletteredLines.length < 2) {
    console.error(
      "❌ ERREUR : Lignes non trouvées dans la GSI. Suggestions reçues :",
      suggBody,
    );
    return;
  }

  const lineKeys = unletteredLines.map((l: any) => ({ PK: l.PK, SK: l.SK }));

  const resConfirm = await postLettering({
    ...commonContext,
    body: JSON.stringify({
      orgId: ORG_ID,
      year: YEAR,
      letteringCode: "X",
      lineKeys: lineKeys,
    }),
  } as any);

  const confirmBody = JSON.parse(resConfirm.body);
  // Validation de l'erreur attendue (API returns `error` on failures)
  if (
    !confirmBody.success &&
    confirmBody.error?.code === "ERROR_INCONSISTENT_PROJECTS"
  ) {
    console.log(
      "✅ SUCCÈS DU TEST : Le système a bien bloqué le lettrage inter-projets.",
    );
  } else {
    console.error(
      "❌ ÉCHEC DU TEST : Le système aurait dû bloquer ce lettrage ! Réponse :",
      confirmBody,
    );
  }

  // --- ETAPE 3 : Test de suggestion filtrée ---
  console.log("\n--- 3️⃣ Test du filtre par projet ---");
  const resFiltered = await getUnlettered({
    ...commonContext,
    queryStringParameters: {
      orgId: ORG_ID,
      accountId: "41110000",
      thirdPartyId: "DONOR-001",
      projectId: "PROJ-A",
    },
  } as any);

  const filteredData = JSON.parse(resFiltered.body).data;
  const linesFound = filteredData?.unletteredLines || [];

  console.log(`🔍 Lignes trouvées pour Projet A : ${linesFound.length}`);

  const allSameProject = linesFound.every((l: any) => l.projectId === "PROJ-A");
  if (allSameProject && linesFound.length >= 1) {
    console.log("✅ SUCCÈS DU TEST : Le filtre Projet fonctionne.");
  } else {
    console.error(
      "❌ ÉCHEC DU TEST : Filtre incorrect ou aucune ligne trouvée.",
    );
  }
}

setupSycebnlData().then(runSycebnlTests).catch(console.error);

/* LOCALSTACK_URL=http://localhost:4566 \
TABLE_NAME=liass-ohada-dev-accounting-table \
AWS_REGION=us-east-1 \
npx ts-node -r tsconfig-paths/register scripts/test-sycebnl-lettering.ts */
