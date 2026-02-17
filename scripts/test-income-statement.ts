import { handler } from "../lambda/domains/core-ledger/analytics/get-income-statement";

// Mocking the API Gateway Event
const event: any = {
  headers: {
    "Accept-Language": "en",
  },
  requestContext: {
    authorizer: {
      claims: {
        orgId: "test-org-001",
      },
    },
  },
  queryStringParameters: {
    year: "2024",
  },
};

async function runTest() {
  console.log("📊 Fetching Income Statement (Profit & Loss) for 2024...");

  try {
    const response = await handler(event);
    const result = JSON.parse(response.body);

    if (response.statusCode === 200) {
      const data = result.data;
      console.log("\n✅ Success! Here is the financial performance:");
      console.table({
        "Fiscal Year": data.fiscalYear,
        "Total Revenue (Class 7)": `${data.totalRevenue} FCFA`,
        "Total Expenses (Class 6)": `${data.totalExpenses} FCFA`,
        "Net Result": `${data.netResult} FCFA`,
        Status: data.performanceStatus,
      });

      if (data.netResult > 0) {
        console.log("🎉 Congratulations! The company is profitable.");
      } else if (data.netResult < 0) {
        console.log("⚠️ Warning: The company is operating at a loss.");
      }
    } else {
      console.error("❌ Error:", result.message);
    }
  } catch (error) {
    console.error("💥 Execution failed:", error);
  }
}

runTest();

// Cmd to run this test:
// ORG_ID=test-org-001 LOCALSTACK_URL=http://localhost:4566 TABLE_NAME=liass-ohada-dev-accounting-table npx ts-node -r tsconfig-paths/register scripts/test-income-statement.ts
