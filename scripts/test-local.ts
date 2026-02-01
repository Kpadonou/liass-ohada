// test-local.ts
import { handler } from "../lambda/domains/core-ledger/entries/post-entry";
import { dynamoClient } from "../lambda/shared/dynamo-client";
import { PutItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";

const mockEvent = {
  body: JSON.stringify({
    year: 2024,
    lines: [
      { accountId: "52100000", debit: 1000, credit: 0 },
      { accountId: "40110000", debit: 0, credit: 500 }, // Déséquilibré
    ],
  }),
  requestContext: {
    authorizer: { claims: { orgId: "test-org-001", userId: "user-123" } },
  },
  headers: {},
} as any;

async function runTest() {
  // Insert fiscal year
  const fiscalYearData = {
    orgId: "test-org-001",
    year: 2024,
    fiscalYearId: "FY-2024",
    startDate: "2024-01-01",
    endDate: "2024-12-31",
    status: "OPEN",
    accountingStandard: "SYSCOHADA_GENERAL",
    pk: "ORG#test-org-001",
    sk: "FY#2024",
    entityType: "FISCAL_YEAR",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await dynamoClient.send(
    new PutItemCommand({
      TableName: process.env.TABLE_NAME!,
      Item: marshall(fiscalYearData, { removeUndefinedValues: true }),
    })
  );

  const res = await handler(mockEvent);
  console.log("RÉSULTAT DU TEST LOCAL :");
  console.log(res.statusCode);
  console.log(res.body);
}

runTest();
