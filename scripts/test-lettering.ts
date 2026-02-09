import { handler } from "../lambda/domains/core-ledger/transactions/post-lettering";
import { dynamoClient } from "../lambda/shared/dynamo-client";
import { PutItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { KeyFactory } from "../lambda/shared/key-builder";

const TABLE = "liass-ohada-dev-accounting-table";
const ORG = "test-org-001";
const YEAR = 2024;
const CLIENT_ID = "CLI-KPADONOU-001";

async function runLetteringTest() {
  console.log("🛠️ Preparing Invoice and Payment for lettering...");

  // 1. La Facture (Vente) - Débit 411
  const invoiceLine = {
    PK: KeyFactory.partitionKey(ORG, YEAR),
    SK: KeyFactory.entryLineSK("INV-001-L1"),
    GSI1PK: KeyFactory.gsiAccountPK(ORG),
    GSI1SK: KeyFactory.gsiAccountSK(
      "41110000",
      YEAR,
      "2024-02-10",
      "INV-001-L1"
    ),
    entityType: "ENTRY_LINE",
    accountId: "41110000",
    thirdPartyId: CLIENT_ID, // <--- Notre Tiers
    debit: 1200,
    credit: 0,
    year: YEAR,
    orgId: ORG,
  };

  // 2. Le Règlement (Encaissement) - Crédit 411
  const paymentLine = {
    PK: KeyFactory.partitionKey(ORG, YEAR),
    SK: KeyFactory.entryLineSK("PAY-001-L1"),
    GSI1PK: KeyFactory.gsiAccountPK(ORG),
    GSI1SK: KeyFactory.gsiAccountSK(
      "41110000",
      YEAR,
      "2024-02-12",
      "PAY-001-L1"
    ),
    entityType: "ENTRY_LINE",
    accountId: "41110000",
    thirdPartyId: CLIENT_ID, // <--- Doit être identique pour que ça passe
    debit: 0,
    credit: 1200, // Équilibre parfait
    year: YEAR,
    orgId: ORG,
  };

  // Injection en base
  await dynamoClient.send(
    new PutItemCommand({ TableName: TABLE, Item: marshall(invoiceLine) })
  );
  await dynamoClient.send(
    new PutItemCommand({ TableName: TABLE, Item: marshall(paymentLine) })
  );

  console.log("🚀 Calling Lettering Handler...");

  // Simulation de l'événement API Gateway
  const event: any = {
    body: JSON.stringify({
      orgId: ORG,
      year: YEAR,
      letteringCode: "AA",
      lines: [
        {
          lineId: "INV-001-L1",
          accountId: "41110000",
          thirdPartyId: CLIENT_ID,
          debit: 1200,
          credit: 0,
        },
        {
          lineId: "PAY-001-L1",
          accountId: "41110000",
          thirdPartyId: CLIENT_ID,
          debit: 0,
          credit: 1200,
        },
      ],
    }),
    headers: { "Accept-Language": "fr" },
    requestContext: { authorizer: { claims: { orgId: ORG } } },
  };

  const result = await handler(event);
  console.log("📥 Result:", JSON.stringify(JSON.parse(result.body), null, 2));
}

runLetteringTest().catch(console.error);

// LOCALSTACK_URL=http://localhost:4566 TABLE_NAME=liass-ohada-dev-accounting-table npx ts-node -r tsconfig-paths/register ./scripts/test-lettering.ts
