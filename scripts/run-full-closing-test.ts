import { PutItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { handler } from "../lambda/domains/core-ledger/fiscal-year/close-fiscal-year";
import { dynamoClient } from "../lambda/shared/dynamo-client";
import { KeyFactory } from "../lambda/shared/key-builder"; // On utilise ton vrai builder

const TABLE = "liass-ohada-dev-accounting-table";
const ORG = "test-org-001";
const YEAR = 2024;

async function runTest() {
  console.log("🛠️ Preparing fresh data with official KeyFactory...");

  // 1. FISCAL_YEAR (PK: ORG#test-org-001, SK: FY#2024)
  const fiscalYear = {
    PK: KeyFactory.orgKey(ORG),
    SK: `FY#${YEAR}`,
    entityType: "FISCAL_YEAR",
    orgId: ORG,
    year: YEAR,
    fiscalYearId: `FY-${YEAR}`,
    startDate: `${YEAR}-01-01T00:00:00Z`,
    endDate: `${YEAR}-12-31T23:59:59Z`,
    status: "OPEN",
    accountingStandard: "SYSCOHADA_GENERAL",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await dynamoClient.send(
    new PutItemCommand({ TableName: TABLE, Item: marshall(fiscalYear) }),
  );

  // 2. ENTRY_LINES (Utilisation rigoureuse de KeyFactory)
  const movements = [
    {
      PK: KeyFactory.partitionKey(ORG, YEAR),
      SK: KeyFactory.entryLineSK("L1"),
      GSI1PK: KeyFactory.gsi1PK(ORG), // Résultat: ORG#test-org-001
      GSI1SK: KeyFactory.gsi1SK("60110000", YEAR, "2024-06-01", "L1"),
      entityType: "ENTRY_LINE",
      accountId: "60110000",
      debit: 1500,
      credit: 0,
      year: YEAR,
      orgId: ORG,
    },
    {
      PK: KeyFactory.partitionKey(ORG, YEAR),
      SK: KeyFactory.entryLineSK("L2"),
      GSI1PK: KeyFactory.gsi1PK(ORG), // Résultat: ORG#test-org-001
      GSI1SK: KeyFactory.gsi1SK("70110000", YEAR, "2024-06-01", "L2"),
      entityType: "ENTRY_LINE",
      accountId: "70110000",
      debit: 0,
      credit: 5000,
      year: YEAR,
      orgId: ORG,
    },
  ];

  for (const m of movements) {
    await dynamoClient.send(
      new PutItemCommand({ TableName: TABLE, Item: marshall(m) }),
    );
  }

  console.log("⏳ Waiting for GSI replication...");
  await new Promise((resolve) => setTimeout(resolve, 1000));

  console.log("🚀 Running Lambda Handler...");

  const event: any = {
    headers: { "Accept-Language": "fr" },
    requestContext: {
      authorizer: { claims: { orgId: ORG, userId: "user-test" } },
    },
    queryStringParameters: { year: YEAR.toString() },
  };

  const result = await handler(event);
  const body = JSON.parse(result.body);

  if (body.success) {
    console.log("✅ SUCCESS!");
    console.log(`Entry ID: ${body.data.entryId}`);
    console.log(`Net Result: ${body.data.netResult}`);
    console.log(`Total Debit: ${body.data.totalDebit}`);
  } else {
    console.log("❌ FAILED:", JSON.stringify(body, null, 2));
  }
}

runTest().catch(console.error);
