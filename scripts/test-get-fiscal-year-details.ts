process.env.TABLE_NAME = "liass-ohada-dev-accounting-table";
process.env.LOCALSTACK_URL = "http://localhost:4566";

import { handler as getDetails } from "../lambda/domains/core-ledger/fiscal-year/get-details";

async function testGetDetails() {
  console.log("🔍 TESTING GET FISCAL YEAR DETAILS");

  const orgId = "test-org-001";
  const year = "2026";

  const event = {
    requestContext: {
      authorizer: { claims: { orgId, userId: "test-admin" } },
    },
    queryStringParameters: {
      year: year,
    },
    headers: { "Accept-Language": "fr" },
  };

  const response = await getDetails(event as any);
  const result = JSON.parse(response.body);

  if (result.success) {
    const data = result.data;

    console.log("\n📅 FISCAL YEAR OVERVIEW:");
    console.log(`ID     : ${data.fiscalYearId}`);
    console.log(`Status : ${data.status} (Global)`);
    console.log(`Period : ${data.startDate} to ${data.endDate}`);

    console.log("\n🔒 MONTHLY LOCKS STATUS:");
    if (Object.keys(data.periodLocks).length === 0) {
      console.log(
        "No specific monthly locks found (All months follow global status)."
      );
    } else {
      console.table(
        Object.entries(data.periodLocks).map(([month, status]) => ({
          Month: month,
          Status: status,
        }))
      );
    }
  } else {
    console.error("❌ Failed to fetch details:", result);
  }
}

testGetDetails().catch(console.error);

/* LOCALSTACK_URL=http://localhost:4566 \
TABLE_NAME=liass-ohada-dev-accounting-table \
AWS_REGION=us-east-1 \
npx ts-node -r tsconfig-paths/register ./scripts/test-get-fiscal-year-details.ts */
