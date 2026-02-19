process.env.TABLE_NAME = "liass-ohada-dev-accounting-table";
process.env.LOCALSTACK_URL = "http://localhost:4566";

import { PutItemCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { dynamoClient } from "../lambda/shared/dynamo-client";
import { handler as postEntry } from "../lambda/domains/core-ledger/entries/post-entry";
import { handler as confirmLettering } from "../lambda/domains/core-ledger/lettering/post-lettering";
import { handler as getAuxiliaryLedger } from "../lambda/domains/core-ledger/books/get-general-ledger";
import { handler as getSuggestions } from "../lambda/domains/core-ledger/lettering/get-unlettered-lines";

/**
 * Prépare l'environnement de test en créant l'exercice fiscal et les comptes
 */
async function setupMasterData(orgId: string) {
  console.log("🏗️  Setting up Master Data (Fiscal Year & Accounts)...");

  const masterData = [
    // 1. Exercice Fiscal 2026
    {
      PK: `ORG#${orgId}`,
      SK: `FY#2026`,
      orgId,
      year: 2026,
      fiscalYearId: `FY-2026`,
      status: "OPEN",
      entityType: "FISCAL_YEAR",
      accountingStandard: "SYSCOHADA_GENERAL",
      startDate: "2026-01-01",
      endDate: "2026-12-31",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    // 2. Compte Client 41110000
    {
      PK: `ORG#${orgId}`,
      SK: `ACC#41110000`,
      accountId: "41110000",
      label: "Clients",
      entityType: "ACCOUNT",
    },
    // 3. Compte de Ventes 70100000 (Padded à 8 chiffres par post-entry)
    {
      PK: `ORG#${orgId}`,
      SK: `ACC#70100000`,
      accountId: "70100000",
      label: "Ventes de marchandises",
      entityType: "ACCOUNT",
    },
    // 4. Compte Banque 52100000
    {
      PK: `ORG#${orgId}`,
      SK: `ACC#52100000`,
      accountId: "52100000",
      label: "Banque",
      entityType: "ACCOUNT",
    },
  ];

  for (const item of masterData) {
    await dynamoClient.send(
      new PutItemCommand({
        TableName: process.env.TABLE_NAME,
        Item: marshall(item),
      }),
    );
  }
  console.log("✅ Master Data ready.");
}

async function runReportTest() {
  const orgId = "test-org-001";
  console.log("📊 STARTING AUXILIARY LEDGER REPORT TEST");

  // Initialisation des données de base
  await setupMasterData(orgId);

  const commonContext = {
    requestContext: {
      authorizer: { claims: { orgId, userId: "test-admin" } },
    },
    headers: { "Accept-Language": "fr" },
  };

  // A. On verrouille Février
  console.log("🔒 Locking February...");
  await dynamoClient.send(
    new PutItemCommand({
      TableName: process.env.TABLE_NAME,
      Item: marshall({
        PK: `ORG#${orgId}#FY#2026`,
        SK: `LOCK#PERIOD#02`,
        status: "LOCKED",
        entityType: "PERIOD_LOCK",
      }),
    }),
  );

  // B. On tente d'écrire (On s'attend à un échec)
  console.log("🧪 Testing block...");
  const failedRes = await postEntry({
    ...commonContext,
    body: JSON.stringify({
      year: 2026,
      entryDate: "2026-02-11",
      label: "Paiement Client C-001",
      journalCode: "BQ",
      lines: [
        { accountId: "52100000", debit: 250, credit: 0 },
        { accountId: "41110000", thirdPartyId: "C-001", debit: 0, credit: 250 },
      ],
    }),
  } as any);

  if (failedRes.statusCode === 400) console.log("✅ Block confirmed!");

  // C. ON DÉVERROUILLE !
  console.log("🔓 Unlocking February...");
  await dynamoClient.send(
    new UpdateItemCommand({
      TableName: process.env.TABLE_NAME,
      Key: marshall({ PK: `ORG#${orgId}#FY#2026`, SK: `LOCK#PERIOD#02` }),
      UpdateExpression: "SET #s = :status",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: marshall({ ":status": "OPEN" }),
    }),
  );

  // 1️⃣ On crée les données (250 + 250) ET l'impayé (500)
  console.log("\n1️⃣ Creating entries...");

  // Facture 1
  await postEntry({
    ...commonContext,
    body: JSON.stringify({
      year: 2026,
      entryDate: "2026-02-11",
      label: "Facture globale F-2026-001",
      journalCode: "VE",
      lines: [
        {
          accountId: "41110000",
          thirdPartyId: "C-001",
          debit: 250,
          credit: 0,
          label: "Partie Marchandises",
        },
        { accountId: "70100000", debit: 0, credit: 250 },
      ],
    }),
  } as any);

  // Paiement 1
  await postEntry({
    ...commonContext,
    body: JSON.stringify({
      year: 2026,
      entryDate: "2026-02-11",
      label: "Paiement Client C-001",
      journalCode: "BQ",
      lines: [
        { accountId: "52100000", debit: 250, credit: 0 },
        { accountId: "41110000", thirdPartyId: "C-001", debit: 0, credit: 250 },
      ],
    }),
  } as any);

  // Facture 2 (Impayée)
  await postEntry({
    ...commonContext,
    body: JSON.stringify({
      year: 2026,
      entryDate: "2026-02-12",
      label: "Facture impayée F-2026-002",
      journalCode: "VE",
      lines: [
        { accountId: "41110000", thirdPartyId: "C-001", debit: 500, credit: 0 },
        { accountId: "70100000", debit: 0, credit: 500 },
      ],
    }),
  } as any);

  // 2️⃣ Récupération dynamique des lignes pour lettrage
  console.log("\n2️⃣ Fetching real lines to letter...");
  const suggRes = await getSuggestions({
    ...commonContext,
    queryStringParameters: {
      orgId,
      accountId: "41110000",
      thirdPartyId: "C-001",
      year: "2026",
    },
  } as any);

  const suggestions = JSON.parse(suggRes.body).data.suggestions;
  const perfectMatch = suggestions.find((s: any) => s.type === "PERFECT_MATCH");

  if (perfectMatch) {
    console.log("✅ Match found, confirming lettering...");
    await confirmLettering({
      ...commonContext,
      body: JSON.stringify({
        orgId,
        year: 2026,
        letteringCode: "B",
        lines: perfectMatch.lines.map((l: any) => ({
          lineId: l.lineId,
          debit: l.type === "DEBIT" ? l.amount : 0,
          credit: l.type === "CREDIT" ? l.amount : 0,
          currentLSk: l.currentLSk,
        })),
      }),
    } as any);
  }

  // 3️⃣ Génération du rapport
  console.log("\n3️⃣ Generating Auxiliary Ledger Report...");
  const reportRes = await getAuxiliaryLedger({
    ...commonContext,
    queryStringParameters: {
      orgId,
      year: "2026",
      accountId: "41110000",
      thirdPartyId: "C-001",
    },
  } as any);

  const result = JSON.parse(reportRes.body);

  if (result.success) {
    const { summary, letteredGroups, unletteredLines } = result.data;

    console.log("\n📈 REPORT SUMMARY:");
    console.table(summary);

    console.log("\n✅ LETTERED GROUPS (History):");
    Object.keys(letteredGroups).forEach((code) => {
      console.log(`Group [${code}]:`);
      console.table(
        letteredGroups[code].map((l: any) => ({
          Date: l.entryDate,
          Label: l.label,
          Debit: l.debit,
          Credit: l.credit,
        })),
      );
    });

    console.log("\n❌ UNLETTERED LINES (Outstanding):");
    console.table(
      unletteredLines.map((l: any) => ({
        Date: l.entryDate,
        Label: l.label,
        Debit: l.debit,
        Credit: l.credit,
      })),
    );
  } else {
    console.error("❌ Failed to generate report:", result);
  }
}

runReportTest().catch(console.error);

/*LOCALSTACK_URL=http://localhost:4566 \
TABLE_NAME=liass-ohada-dev-accounting-table \
AWS_REGION=us-east-1 \
npx ts-node -r tsconfig-paths/register scripts/test-auxiliary-report.ts */
