// Set environment variables for local testing BEFORE any imports
process.env.TABLE_NAME = "liass-ohada-dev-accounting-table";
process.env.LOCALSTACK_URL = "http://localhost:4566";

import {
  DeleteItemCommand,
  PutItemCommand,
  ScanCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { handler as postEntry } from "../lambda/domains/accounting/entries/post-entry";
import { handler as getSuggestions } from "../lambda/domains/accounting/lettering/get-unlettered-lines";
import { dynamoClient } from "../lambda/shared/dynamo-client";
import { KeyFactory } from "../lambda/shared/key-builder";

async function cleanupTable() {
  console.log("🧹 Cleaning up table...");
  const scan = await dynamoClient.send(
    new ScanCommand({ TableName: process.env.TABLE_NAME }),
  );
  const items = scan.Items || [];
  for (const item of items) {
    const unmarshalled = unmarshall(item);
    await dynamoClient.send(
      new DeleteItemCommand({
        TableName: process.env.TABLE_NAME,
        Key: marshall({ PK: unmarshalled.PK, SK: unmarshalled.SK }),
      }),
    );
  }
  console.log(`✅ Table cleared (${items.length} items removed)`);
}

async function setupMasterData() {
  const orgId = "test-org-001";
  const now = new Date().toISOString();

  // 1. Fiscal Year (COMPLET pour passer le FiscalYearSchema.parse)
  await dynamoClient.send(
    new PutItemCommand({
      TableName: process.env.TABLE_NAME!,
      Item: marshall({
        PK: KeyFactory.orgKey(orgId),
        SK: "FY#2026",
        orgId,
        year: 2026,
        fiscalYearId: "FY-2026-ID", // Requis par Zod
        startDate: "2026-01-01", // Requis par Zod
        endDate: "2026-12-31", // Requis par Zod
        status: "OPEN",
        accountingFramework: "SYSCOHADA_REVISED", // Requis par Zod
        entityType: "FISCAL_YEAR",
        createdAt: now,
        updatedAt: now,
      }),
    }),
  );

  // 2. Accounts
  const accounts = [
    { id: "41110000", name: "Clients", isTP: true },
    { id: "70100000", name: "Ventes", isTP: false },
    { id: "52100000", name: "Banque", isTP: false },
  ];

  for (const acc of accounts) {
    await dynamoClient.send(
      new PutItemCommand({
        TableName: process.env.TABLE_NAME!,
        Item: marshall({
          PK: KeyFactory.orgKey(orgId),
          SK: KeyFactory.accountSK(acc.id),
          accountId: acc.id,
          accountName: acc.name,
          isThirdPartyAccount: acc.isTP,
          entityType: "ACCOUNT",
          createdAt: now,
          updatedAt: now,
        }),
      }),
    );
  }

  // 3. Third Party
  await dynamoClient.send(
    new PutItemCommand({
      TableName: process.env.TABLE_NAME!,
      Item: marshall({
        PK: KeyFactory.orgKey(orgId),
        SK: "TP#CLIE#CLIENT-001",
        thirdPartyId: "CLIENT-001",
        type: "CLIENT",
        entityType: "THIRD_PARTY",
        createdAt: now,
        updatedAt: now,
      }),
    }),
  );

  console.log("✅ Master data initialized with complete fields");
}

// async function runScenario() {
//   console.log("🚀 STARTING RECONCILIATION TEST SCENARIO");
//   await cleanupTable();
//   await setupMasterData();

//   const commonContext = {
//     requestContext: {
//       authorizer: { claims: { orgId: "test-org-001", userId: "test-admin" } },
//     },
//     headers: { "Accept-Language": "en" },
//   };

//   // 1️⃣ POST INVOICE
//   console.log("\n1️⃣ Posting Invoice (100.00)...");
//   const invoiceRes = await postEntry({
//     ...commonContext,
//     body: JSON.stringify({
//       orgId: "test-org-001", // Parfois requis selon le schéma
//       year: 2026,
//       entryDate: "2026-02-09",
//       label: "Invoice INV-001",
//       lines: [
//         {
//           accountId: "41110000",
//           thirdPartyId: "CLIENT-001",
//           debit: 100,
//           credit: 0,
//         },
//         { accountId: "70100000", debit: 0, credit: 100 },
//       ],
//     }),
//   } as any);

//   // 2️⃣ POST PAYMENT
//   console.log("2️⃣ Posting Payment (100.00)...");
//   const paymentRes = await postEntry({
//     ...commonContext,
//     body: JSON.stringify({
//       orgId: "test-org-001",
//       year: 2026,
//       entryDate: "2026-02-10",
//       label: "Payment PAY-001",
//       lines: [
//         { accountId: "52100000", debit: 100, credit: 0 },
//         {
//           accountId: "41110000",
//           thirdPartyId: "CLIENT-001",
//           debit: 0,
//           credit: 100,
//         },
//       ],
//     }),
//   } as any);

//   // 3️⃣ FETCH SUGGESTIONS
//   console.log("\n3️⃣ Querying Matching Engine...");
//   const suggestionRes = await getSuggestions({
//     ...commonContext,
//     queryStringParameters: {
//       orgId: "test-org-001",
//       accountId: "41110000",
//       thirdPartyId: "CLIENT-001",
//     },
//   } as any);

//   const result = JSON.parse(suggestionRes.body);

//   if (result.success && result.data) {
//     console.log("\n📊 ENGINE RESULTS:");
//     console.log(`Unlettered lines: ${result.data.totalUnlettered}`);
//     console.log(`Suggestions: ${result.data.suggestionsFound}`);

//     if (result.data.suggestionsFound > 0) {
//       console.log("\n🎯 SUCCESS: Match Found!");
//       console.table(result.data.suggestions[0].lines);
//     } else {
//       console.log("\n⚠️ Still no match? Check the data in the table.");
//     }
//   } else {
//     console.error("❌ ERROR in suggestion response:", result);
//   }
// }

// runScenario().catch(console.error);

async function runFifoScenario() {
  console.log("🚀 STARTING FIFO RECONCILIATION TEST SCENARIO");
  await cleanupTable();
  await setupMasterData();

  const commonContext = {
    requestContext: {
      authorizer: { claims: { orgId: "test-org-001", userId: "test-admin" } },
    },
    headers: { "Accept-Language": "en" },
  };

  // 1️⃣ FACTURE 1 (50.00) le 01 Février
  console.log("\n1️⃣ Posting Invoice 1 (50.00) - Feb 1st...");
  await postEntry({
    ...commonContext,
    body: JSON.stringify({
      year: 2026,
      entryDate: "2026-02-01",
      label: "Invoice INV-001",
      lines: [
        {
          accountId: "41110000",
          thirdPartyId: "CLIENT-001",
          debit: 50,
          credit: 0,
        },
        { accountId: "70100000", debit: 0, credit: 50 },
      ],
    }),
  } as any);

  // 2️⃣ FACTURE 2 (50.00) le 05 Février
  console.log("2️⃣ Posting Invoice 2 (50.00) - Feb 5th...");
  await postEntry({
    ...commonContext,
    body: JSON.stringify({
      year: 2026,
      entryDate: "2026-02-05",
      label: "Invoice INV-002",
      lines: [
        {
          accountId: "41110000",
          thirdPartyId: "CLIENT-001",
          debit: 50,
          credit: 0,
        },
        { accountId: "70100000", debit: 0, credit: 50 },
      ],
    }),
  } as any);

  // 3️⃣ PAIEMENT GLOBAL (100.00) le 10 Février
  console.log("3️⃣ Posting Global Payment (100.00) - Feb 10th...");
  await postEntry({
    ...commonContext,
    body: JSON.stringify({
      year: 2026,
      entryDate: "2026-02-10",
      label: "Global Payment PAY-ALL",
      lines: [
        { accountId: "52100000", debit: 100, credit: 0 },
        {
          accountId: "41110000",
          thirdPartyId: "CLIENT-001",
          debit: 0,
          credit: 100,
        },
      ],
    }),
  } as any);

  // 4️⃣ FETCH SUGGESTIONS
  console.log("\n4️⃣ Querying Matching Engine for FIFO suggestions...");
  const suggestionRes = await getSuggestions({
    ...commonContext,
    queryStringParameters: {
      orgId: "test-org-001",
      accountId: "41110000",
      thirdPartyId: "CLIENT-001",
    },
  } as any);

  const result = JSON.parse(suggestionRes.body);

  if (result.success && result.data) {
    console.log("\n📊 FIFO ENGINE RESULTS:");
    console.log(`Unlettered lines: ${result.data.totalUnlettered}`); // Devrait être 3 (2 factures + 1 paiement)
    console.log(`Suggestions: ${result.data.suggestionsFound}`);

    result.data.suggestions.forEach((suggestion: any, idx: number) => {
      console.log(
        `\nSuggestion #${idx + 1} [${suggestion.type}] - Amount: ${
          suggestion.amount
        }`,
      );
      console.table(
        suggestion.lines.map((l: any) => ({
          Date: l.date,
          Role: l.role || l.type,
          Amount: l.amount,
          Entry: l.entryId,
        })),
      );
    });
  }
}

runFifoScenario().catch(console.error);
