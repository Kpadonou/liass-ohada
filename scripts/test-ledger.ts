import { handler } from "../lambda/domains/core-ledger/books/get-general-ledger";

// On simule l'objet "event" qu'AWS Lambda recevrait
const mockEvent: any = {
  headers: { "Accept-Language": "fr" },
  requestContext: {
    authorizer: { claims: { orgId: "test-org-001" } },
  },
  queryStringParameters: {
    accountId: "521", // On cherche le compte Banque
    fiscalYear: "2024",
  },
};

async function runTest() {
  console.log("📖 Lecture du Grand Livre pour le compte 521 (Banque)...");

  try {
    const result = await handler(mockEvent);
    const body = JSON.parse(result.body);

    if (result.statusCode === 200) {
      console.log("\n✅ Succès ! Voici les mouvements :");
      // console.table permet d'afficher les données sous forme de tableau
      console.table(body.data);
    } else {
      console.error("❌ Erreur :", body.message);
    }
  } catch (err) {
    console.error("💥 Crash du test :", err);
  }
}

runTest();

// Cmd to run the test:
// ORG_ID=test-org-001 LOCALSTACK_URL=http://localhost:4566 TABLE_NAME=liass-ohada-dev-accounting-table npx ts-node -r tsconfig-paths/register scripts/test-ledger.ts
