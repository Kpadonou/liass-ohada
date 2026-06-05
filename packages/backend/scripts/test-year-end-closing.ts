// test-year-end-closing.ts
import { handler } from "../lambda/domains/accounting/fiscal-year/close-fiscal-year";

const mockEvent = {
  requestContext: {
    authorizer: {
      claims: {
        orgId: "test-org-001",
        userId: "user-123",
      },
    },
  },
  queryStringParameters: {
    year: "2024",
  },
  headers: {
    "Accept-Language": "en",
  },
} as any;

async function runTest() {
  try {
    const result = await handler(mockEvent);
    console.log("Year-End Closing Result:");
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error("Error:", error);
  }
}

runTest();
