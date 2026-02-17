import { handler } from "../lambda/domains/core-ledger/books/get-trial-balance";

const mockEvent: any = {
  headers: { "Accept-Language": "fr" },
  requestContext: {
    authorizer: { claims: { orgId: "test-org-001" } },
  },
  queryStringParameters: { year: "2024" },
};

async function runTest() {
  console.log("📊 Fetching Trial Balance for 2024...");
  const result = await handler(mockEvent);
  const body = JSON.parse(result.body);

  if (result.statusCode === 200) {
    console.table(body.data); // Affiche un beau tableau dans ton terminal
  } else {
    console.error("❌ Error:", body);
  }
}

runTest();

// Cmd to run the script:
// ORG_ID=test-org-001 LOCALSTACK_URL=http://localhost:4566 TABLE_NAME=liass-ohada-dev-accounting-table npx ts-node -r tsconfig-paths/register scripts/invoke-balance.ts
