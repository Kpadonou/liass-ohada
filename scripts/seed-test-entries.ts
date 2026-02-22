import { PutItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { dynamoClient } from "@/lambda/shared/dynamo-client";
import { config } from "@/lambda/shared/config";
import { KeyFactory } from "@/lambda/shared/key-builder";

/**
 * Seed script for accounting lines linked to projects.
 * This populates GSI4 (Project Ledger).
 */
async function seedTransactions() {
  const orgId = "org-test-dash";
  const year = "2026";
  const date = "2026-02-22";

  // Simulation de 3 lignes : une dépense WASH, un financement EDU, et une dépense EDU
  const transactions = [
    {
      id: "L-WASH-EXP-01",
      prj: "WASH-001",
      acc: "62210000",
      debit: 750000,
      credit: 0,
      desc: "Achat kits hygiène",
    },
    {
      id: "L-EDU-FUND-01",
      prj: "EDU-002",
      acc: "75100000",
      debit: 0,
      credit: 12000000,
      desc: "Subvention Banque Mondiale",
    },
    {
      id: "L-EDU-EXP-01",
      prj: "EDU-002",
      acc: "60510000",
      debit: 2500000,
      credit: 0,
      desc: "Fournitures scolaires",
    },
  ];

  console.log("--- 💸 Injecting Analytical Transactions (GSI4) ---");

  for (const t of transactions) {
    const item = {
      // Primary Key (Transactional Partition by Year)
      PK: KeyFactory.partitionKey(orgId, year),
      SK: KeyFactory.entryLineSK(t.id), // L#...

      // Core Data
      orgId: orgId,
      projectId: t.prj,
      accountId: t.acc,
      debit: t.debit,
      credit: t.credit,
      fiscalYear: year,
      date: date,
      description: t.desc,

      // --- THE DASHBOARD ENGINE (GSI4) ---
      // We use the new Global PK for the Org
      GSI4PK: KeyFactory.gsi4PK(orgId),
      // And the hierarchical SK: PRJ#<id>#FY#<year>...
      GSI4SK: KeyFactory.gsi4SK(t.prj, year, date, t.id),
    };

    await dynamoClient.send(
      new PutItemCommand({
        TableName: config.TABLE_NAME,
        Item: marshall(item),
      }),
    );

    console.log(`✅ Line ${t.id} posted to Project ${t.prj}`);
  }
}

seedTransactions().catch(console.error);
