process.env.TABLE_NAME = "liass-ohada-dev-accounting-table";
process.env.LOCALSTACK_URL = "http://localhost:4566";

import { handler as postEntry } from "../lambda/domains/core-ledger/entries/post-entry";
import { handler as getSuggestions } from "../lambda/domains/core-ledger/queries/get-lettering-suggestions";
import { handler as confirmLettering } from "../lambda/domains/core-ledger/transactions/post-lettering";
import { handler as unLettering } from "../lambda/domains/core-ledger/entries/un-lettering";
import {
  PutItemCommand,
  ScanCommand,
  DeleteItemCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { dynamoClient } from "../lambda/shared/dynamo-client";
import { KeyFactory } from "../lambda/shared/key-builder";

async function setupBase() {
  const orgId = "test-org-001";
  const now = new Date().toISOString();
  console.log("🧹 Cleaning table...");
  // ... (le cleanup est supposé être fait ici ou par un script externe)

  console.log("🏗️ Setting up Master Data...");
  await dynamoClient.send(
    new PutItemCommand({
      TableName: process.env.TABLE_NAME!,
      Item: marshall({
        PK: KeyFactory.orgKey(orgId),
        SK: "FY#2026",
        orgId,
        year: 2026,
        fiscalYearId: "FY26",
        startDate: "2026-01-01",
        endDate: "2026-12-31",
        status: "OPEN",
        accountingStandard: "SYSCOHADA_GENERAL",
        entityType: "FISCAL_YEAR",
        createdAt: now,
        updatedAt: now,
      }),
    })
  );
  await dynamoClient.send(
    new PutItemCommand({
      TableName: process.env.TABLE_NAME!,
      Item: marshall({
        PK: KeyFactory.orgKey(orgId),
        SK: KeyFactory.accountSK("41110000"),
        accountId: "41110000",
        accountName: "Clients",
        isThirdPartyAccount: true,
        entityType: "ACCOUNT",
        createdAt: now,
        updatedAt: now,
      }),
    })
  );
}

async function runFullCycle() {
  console.log("🚀 STARTING FULL LETTERING CYCLE TEST");
  const commonContext = {
    requestContext: {
      authorizer: { claims: { orgId: "test-org-001", userId: "test-admin" } },
    },
    headers: { "Accept-Language": "fr" },
  };

  // 1️⃣ PHASE 1: Data Entry
  console.log("\n--- PHASE 1: Data Entry ---");
  await postEntry({
    ...commonContext,
    body: JSON.stringify({
      year: 2026,
      entryDate: "2026-02-11",
      label: "Invoice",
      lines: [
        { accountId: "41110000", thirdPartyId: "C-001", debit: 250, credit: 0 },
        { accountId: "70100000", debit: 0, credit: 250 },
      ],
    }),
  } as any);

  await postEntry({
    ...commonContext,
    body: JSON.stringify({
      year: 2026,
      entryDate: "2026-02-11",
      label: "Payment",
      lines: [
        { accountId: "52100000", debit: 250, credit: 0 },
        { accountId: "41110000", thirdPartyId: "C-001", debit: 0, credit: 250 },
      ],
    }),
  } as any);
  console.log("✅ Entries created.");

  // 2️⃣ PHASE 2: Fetching Suggestions
  console.log("\n--- PHASE 2: Fetching Suggestions ---");
  const suggRes = await getSuggestions({
    ...commonContext,
    queryStringParameters: {
      orgId: "test-org-001",
      accountId: "41110000",
      thirdPartyId: "C-001",
      year: "2026",
    },
  } as any);

  const suggBody = JSON.parse(suggRes.body);

  if (!suggBody.success) {
    console.error("❌ Lambda error:", JSON.stringify(suggBody, null, 2));
    return;
  }

  const suggData = suggBody.data;
  console.log(`🔍 Suggestions found: ${suggData?.suggestionsFound}`);

  if (!suggData || suggData.suggestionsFound === 0) {
    console.log(
      "⚠️ No matches found. Response was:",
      JSON.stringify(suggBody, null, 2)
    );
    return;
  }

  const targetMatch = suggData.suggestions[0];

  // 3️⃣ PHASE 3: Confirm Lettering
  console.log("\n--- PHASE 3: Confirming Lettering ---");
  const confirmRes = await confirmLettering({
    ...commonContext,
    body: JSON.stringify({
      orgId: "test-org-001",
      year: 2026,
      letteringCode: "A",
      lines: targetMatch.lines.map((l: any) => ({
        ...l,
        currentLSk: l.currentLSk || `UNLETTERED#${l.date}#${l.entryId}`,
      })),
    }),
  } as any);

  console.log("✅ Confirmation Response:", confirmRes.body);

  // 4️⃣ PHASE 4: Un-lettering
  console.log("\n--- PHASE 4: Un-lettering ---");
  const unRes = await unLettering({
    ...commonContext,
    body: JSON.stringify({
      orgId: "test-org-001",
      year: 2026,
      lines: targetMatch.lines.map((l: any) => ({
        lineId: l.lineId,
        currentLSk: `LETTERED#A#${l.date}#${l.entryId}`,
      })),
    }),
  } as any);
  console.log("✅ Un-lettering Response:", unRes.body);
}

setupBase().then(runFullCycle).catch(console.error);
