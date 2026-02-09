import { handler } from "../lambda/domains/core-ledger/transactions/post-lettering";
import { dynamoClient } from "../lambda/shared/dynamo-client";
import { PutItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { KeyFactory } from "../lambda/shared/key-builder";

const TABLE = "liass-ohada-dev-accounting-table";
const ORG = "test-org-001";
const YEAR = 2024;
const CLIENT_ID = "CLI-KPADONOU-001";

async function runPartialTest() {
  console.log("1️⃣ Step 1: Creating 1 Invoice (1000) and 1st Payment (400)...");

  const lines = [
    { id: "INV-100", acc: "41110000", d: 1000, c: 0 },
    { id: "PAY-400", acc: "41110000", d: 0, c: 400 },
    { id: "PAY-600", acc: "41110000", d: 0, c: 600 },
  ];

  // On injecte tout en base
  for (const l of lines) {
    await dynamoClient.send(
      new PutItemCommand({
        TableName: TABLE,
        Item: marshall({
          PK: KeyFactory.partitionKey(ORG, YEAR),
          SK: KeyFactory.entryLineSK(l.id),
          GSI1PK: KeyFactory.gsiAccountPK(ORG),
          GSI1SK: KeyFactory.gsiAccountSK(l.acc, YEAR, "2024-02-10", l.id),
          entityType: "ENTRY_LINE",
          accountId: l.acc,
          thirdPartyId: CLIENT_ID,
          debit: l.d,
          credit: l.c,
          year: YEAR,
        }),
      })
    );
  }

  console.log("2️⃣ Step 2: Lettering INV-100 + PAY-400 (Should be partial)...");

  const partialEvent: any = {
    headers: { "Accept-Language": "fr" },
    body: JSON.stringify({
      orgId: ORG,
      year: YEAR,
      letteringCode: "BA",
      lines: [
        {
          lineId: "INV-100",
          accountId: "41110000",
          thirdPartyId: CLIENT_ID,
          debit: 1000,
          credit: 0,
        },
        {
          lineId: "PAY-400",
          accountId: "41110000",
          thirdPartyId: CLIENT_ID,
          debit: 0,
          credit: 400,
        },
      ],
    }),
    requestContext: { authorizer: { claims: { orgId: ORG } } },
  };

  const res1 = await handler(partialEvent);
  const body1 = JSON.parse(res1.body);
  console.log(
    `📥 Result 1: Code=[${body1.data.letteringCode}] Status=[${body1.data.letteringStatus}]`
  );

  console.log(
    "3️⃣ Step 3: Lettering ALL (INV-100 + PAY-400 + PAY-600) (Should be complete)..."
  );

  const totalEvent: any = {
    headers: { "Accept-Language": "fr" },
    body: JSON.stringify({
      orgId: ORG,
      year: YEAR,
      letteringCode: "BA",
      lines: [
        {
          lineId: "INV-100",
          accountId: "41110000",
          thirdPartyId: CLIENT_ID,
          debit: 1000,
          credit: 0,
        },
        {
          lineId: "PAY-400",
          accountId: "41110000",
          thirdPartyId: CLIENT_ID,
          debit: 0,
          credit: 400,
        },
        {
          lineId: "PAY-600",
          accountId: "41110000",
          thirdPartyId: CLIENT_ID,
          debit: 0,
          credit: 600,
        },
      ],
    }),
    requestContext: { authorizer: { claims: { orgId: ORG } } },
  };

  const res2 = await handler(totalEvent);
  const body2 = JSON.parse(res2.body);
  console.log(
    `📥 Result 2: Code=[${body2.data.letteringCode}] Status=[${body2.data.letteringStatus}]`
  );
}

runPartialTest().catch(console.error);

// LOCALSTACK_URL=http://localhost:4566 TABLE_NAME=liass-ohada-dev-accounting-table npx ts-node -r tsconfig-paths/register ./scripts/test-partial-lettering.ts
