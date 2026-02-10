import { dynamoClient } from "../lambda/shared/dynamo-client";
import { TransactWriteItemsCommand } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { KeyFactory } from "../lambda/shared/key-builder";
import { config } from "../lambda/shared/config";

async function seedCleanData() {
  const orgId = "test-org-001";
  const tableName = config.TABLE_NAME;
  const year = 2024;

  const entries = [
    // 1. OPENING BALANCE (Not used in Income Statement, but good for Trial Balance)
    {
      entryId: "ENT-2024-001",
      date: "2024-01-01",
      journalCode: "RAN",
      description: "Opening Balance",
      lines: [
        { accountId: "52100000", debit: 10000, credit: 0 },
        { accountId: "10110000", debit: 0, credit: 10000 },
      ],
    },
    // 2. PURCHASE (Expense - Class 6)
    {
      entryId: "ENT-2024-002",
      date: "2024-02-15",
      journalCode: "HA",
      description: "Office Supplies",
      lines: [
        { accountId: "60110000", debit: 1500, credit: 0 }, // Expense
        { accountId: "52100000", debit: 0, credit: 1500 },
      ],
    },
    // 3. SALE (Revenue - Class 7)
    {
      entryId: "ENT-2024-003",
      date: "2024-03-10",
      journalCode: "VT",
      description: "Service Consulting",
      lines: [
        { accountId: "52100000", debit: 5000, credit: 0 },
        { accountId: "70110000", debit: 0, credit: 5000 }, // Revenue
      ],
    },
  ];

  for (const entry of entries) {
    const transactItems = entry.lines.map((line) => {
      const lineId = `L-${entry.entryId}-${line.accountId}`;
      return {
        Put: {
          TableName: tableName,
          Item: marshall({
            PK: KeyFactory.partitionKey(orgId, year),
            SK: KeyFactory.entryLineSK(lineId),
            GSI1PK: KeyFactory.gsi1PK(orgId),
            GSI1SK: KeyFactory.gsi1SK(line.accountId, year, entry.date, lineId),
            entityType: "ENTRY_LINE",
            accountId: line.accountId,
            entryId: entry.entryId,
            journalCode: entry.journalCode,
            description: entry.description,
            debit: line.debit,
            credit: line.credit,
            entryDate: entry.date,
            year: year,
          }),
        },
      };
    });

    await dynamoClient.send(
      new TransactWriteItemsCommand({ TransactItems: transactItems })
    );
    console.log(`✅ Entry ${entry.entryId} injected`);
  }
}

seedCleanData();

// Cmd to run the script:
// ORG_ID=test-org-001 LOCALSTACK_URL=http://localhost:4566 TABLE_NAME=liass-ohada-dev-accounting-table npx ts-node ./scripts/seed-test-entries.ts
