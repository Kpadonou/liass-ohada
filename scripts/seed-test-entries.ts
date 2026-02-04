import { dynamoClient } from "../lambda/shared/dynamo-client";
import { TransactWriteItemsCommand } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { KeyFactory } from "../lambda/shared/key-builder";
import { config } from "../lambda/shared/config";

/**
 * Test Scenarios for 2024:
 * 1. Purchase of goods (1500) -> 60110000 (D) / 40110000 (C)
 * 2. Partial payment (750)  -> 40110000 (D) / 52100000 (C)
 * 3. Capital contribution (2000) -> 52100000 (D) / 10110000 (C)
 * 4. ONE ENTRY IN 2025 (999) -> To verify isolation.
 */

async function seedTestEntries() {
  const orgId = "test-org-001";
  const tableName = config.TABLE_NAME;

  console.log(`🚀 Injecting test entries for ${orgId}...\n`);

  const entries = [
    // --- ENTRY 1: Purchase (2024) ---
    {
      year: 2024,
      entryId: "ENT-2024-001",
      date: "2024-01-15",
      lines: [
        { accountId: "60110000", debit: 1500, credit: 0 },
        { accountId: "40110000", debit: 0, credit: 1500 },
      ],
    },
    // --- ENTRY 2: Payment (2024) ---
    {
      year: 2024,
      entryId: "ENT-2024-002",
      date: "2024-02-10",
      lines: [
        { accountId: "40110000", debit: 750, credit: 0 },
        { accountId: "52100000", debit: 0, credit: 750 },
      ],
    },
    // --- ENTRY 3: Investment (2024) ---
    {
      year: 2024,
      entryId: "ENT-2024-003",
      date: "2024-03-01",
      lines: [
        { accountId: "52100000", debit: 2000, credit: 0 },
        { accountId: "10110000", debit: 0, credit: 2000 },
      ],
    },
    // --- ENTRY 4: Isolation Test (2025) ---
    {
      year: 2025,
      entryId: "ENT-2025-999",
      date: "2025-01-01",
      lines: [
        { accountId: "52100000", debit: 999, credit: 0 },
        { accountId: "10110000", debit: 0, credit: 999 },
      ],
    },
  ];

  for (const entry of entries) {
    const transactItems = [];

    // 1. Add Entry Header
    transactItems.push({
      Put: {
        TableName: tableName,
        Item: marshall({
          PK: KeyFactory.partitionKey(orgId, entry.year),
          SK: KeyFactory.entrySK(entry.entryId),
          entityType: "ENTRY",
          year: entry.year,
          entryDate: entry.date,
          totalDebit: entry.lines.reduce((sum, l) => sum + l.debit, 0),
          totalCredit: entry.lines.reduce((sum, l) => sum + l.credit, 0),
          createdAt: new Date().toISOString(),
        }),
      },
    });

    // 2. Add Lines
    for (const line of entry.lines) {
      const lineId = `L-${entry.entryId}-${line.accountId}`;
      transactItems.push({
        Put: {
          TableName: tableName,
          Item: marshall({
            PK: KeyFactory.partitionKey(orgId, entry.year),
            SK: KeyFactory.entryLineSK(lineId),
            GSI1PK: KeyFactory.gsiAccountPK(orgId),
            GSI1SK: KeyFactory.gsiAccountSK(
              line.accountId,
              entry.year,
              entry.date,
              lineId
            ),
            entityType: "ENTRY_LINE",
            accountId: line.accountId,
            debit: line.debit,
            credit: line.credit,
            entryDate: entry.date,
            year: entry.year,
          }),
        },
      });
    }

    try {
      await dynamoClient.send(
        new TransactWriteItemsCommand({ TransactItems: transactItems })
      );
      console.log(`✅ Entry ${entry.entryId} (${entry.year}) injected.`);
    } catch (err) {
      console.error(`❌ Error for ${entry.entryId}:`, err);
    }
  }

  console.log("\n✨ Testing data ready!");
}

seedTestEntries();
