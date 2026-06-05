import { BatchWriteItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { padAccountId } from "@liass-ohada/shared/accounting";
import { KeyFactory } from "../lambda/shared/key-builder";
import { dynamoClient } from "../lambda/shared/dynamo-client";
import { config } from "../lambda/shared/config";

interface SeedAccount {
  accountId: string;
  accountName: string;
  accountNature: "BALANCE" | "INCOME";
  accountUsage: "DEBIT_ONLY" | "CREDIT_ONLY" | "BOTH";
  financialStatementCode: string;
  allowReconciliation?: boolean;
}

interface SeedJournal {
  journalCode: string;
  journalName: string;
  type: "PURCHASE" | "SALE" | "BANK" | "MISC";
}

/**
 * Base OHADA Chart of Accounts (Plan de Comptes)
 * Supports SYSCOHADA General (Commercial) standard
 */
const OHADA_ACCOUNTS: SeedAccount[] = [
  // Class 1: Capital and Reserves
  {
    accountId: "1011",
    accountName: "Capital social",
    accountNature: "BALANCE",
    accountUsage: "BOTH",
    financialStatementCode: "B01",
    allowReconciliation: false,
  },

  // Class 2: Fixed Assets
  {
    accountId: "2411",
    accountName: "Matériel et outillage",
    accountNature: "BALANCE",
    accountUsage: "DEBIT_ONLY",
    financialStatementCode: "B02",
    allowReconciliation: false,
  },

  // Class 4: Third Parties
  {
    accountId: "4011",
    accountName: "Fournisseurs",
    accountNature: "BALANCE",
    accountUsage: "CREDIT_ONLY",
    financialStatementCode: "B03",
    allowReconciliation: true,
  },
  {
    accountId: "4111",
    accountName: "Clients",
    accountNature: "BALANCE",
    accountUsage: "DEBIT_ONLY",
    financialStatementCode: "B04",
    allowReconciliation: true,
  },

  // Class 5: Financial Assets
  {
    accountId: "521",
    accountName: "Banque",
    accountNature: "BALANCE",
    accountUsage: "BOTH",
    financialStatementCode: "B05",
    allowReconciliation: true,
  },
  {
    accountId: "571",
    accountName: "Caisse",
    accountNature: "BALANCE",
    accountUsage: "BOTH",
    financialStatementCode: "B06",
    allowReconciliation: true,
  },

  // Class 6: Purchase/Cost Accounts
  {
    accountId: "6011",
    accountName: "Achats de marchandises",
    accountNature: "INCOME",
    accountUsage: "DEBIT_ONLY",
    financialStatementCode: "I01",
    allowReconciliation: false,
  },

  // Class 7: Revenue Accounts
  {
    accountId: "7011",
    accountName: "Ventes de marchandises",
    accountNature: "INCOME",
    accountUsage: "CREDIT_ONLY",
    financialStatementCode: "I02",
    allowReconciliation: false,
  },
];

/**
 * Standard OHADA Journals
 */
const OHADA_JOURNALS: SeedJournal[] = [
  {
    journalCode: "BQ",
    journalName: "Journal de Banque",
    type: "BANK",
  },
  {
    journalCode: "VE",
    journalName: "Journal des Ventes",
    type: "SALE",
  },
  {
    journalCode: "AC",
    journalName: "Journal des Achats",
    type: "PURCHASE",
  },
  {
    journalCode: "OD",
    journalName: "Journal des Opérations Diverses",
    type: "MISC",
  },
];

/**
 * Extract class code from account ID (first digit)
 */
const getClassCode = (accountId: string): number => {
  return parseInt(accountId.charAt(0), 10);
};

/**
 * Seed OHADA chart of accounts and journals for an organization
 */
async function seedOhadaData(): Promise<void> {
  const orgId = process.env.ORG_ID;
  if (!orgId) {
    console.error(
      "ERROR: ORG_ID environment variable is required.\nUsage: ORG_ID=org-123 npx ts-node scripts/seed-ohada-accounts.ts"
    );
    process.exit(1);
  }

  const tableName = config.TABLE_NAME;
  console.log(
    `\n🌍 Seeding OHADA Chart of Accounts for Organization: ${orgId}`
  );
  console.log(`📊 Table: ${tableName}\n`);

  try {
    const requestItems: Record<string, any[]> = {};
    requestItems[tableName] = [];

    for (const seedAccount of OHADA_ACCOUNTS) {
      const accountIdInput = seedAccount.accountId;
      const accountId = padAccountId(accountIdInput);
      const classCode = getClassCode(accountIdInput);

      const accountData = {
        orgId,
        accountId,
        accountName: seedAccount.accountName,
        accountNature: seedAccount.accountNature,
        accountUsage: seedAccount.accountUsage,
        isThirdPartyAccount: false,
        classCode,
        financialStatementCode: seedAccount.financialStatementCode,
        allowReconciliation: seedAccount.allowReconciliation ?? false,
        entityType: "ACCOUNT",
        PK: KeyFactory.orgKey(orgId),
        SK: KeyFactory.accountSK(accountId),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      requestItems[tableName].push({
        PutRequest: {
          Item: marshall(accountData, { removeUndefinedValues: true }),
        },
      });

      console.log(
        `✓ ${accountIdInput.padEnd(6)} | ${accountData.accountName.padEnd(
          35
        )} | Class ${classCode} | ${accountData.accountNature.padEnd(6)} | ${
          accountData.accountUsage
        }`
      );
    }

    // Seed journals
    for (const seedJournal of OHADA_JOURNALS) {
      const journalData = {
        orgId,
        journalCode: seedJournal.journalCode,
        journalName: seedJournal.journalName,
        type: seedJournal.type,
        entityType: "JOURNAL",
        PK: KeyFactory.orgKey(orgId),
        SK: KeyFactory.journalSK(seedJournal.journalCode),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      requestItems[tableName].push({
        PutRequest: {
          Item: marshall(journalData, { removeUndefinedValues: true }),
        },
      });

      console.log(
        `✓ ${seedJournal.journalCode.padEnd(
          6
        )} | ${seedJournal.journalName.padEnd(35)} | ${seedJournal.type}`
      );
    }

    // Execute batch write
    console.log(
      `\n📝 Writing ${OHADA_ACCOUNTS.length} accounts and ${OHADA_JOURNALS.length} journals to DynamoDB...\n`
    );

    const command = new BatchWriteItemCommand({
      RequestItems: requestItems,
    });

    const response = await dynamoClient.send(command);

    if (
      response.UnprocessedItems &&
      Object.keys(response.UnprocessedItems).length > 0
    ) {
      console.warn(
        "⚠️  Some items were unprocessed. This may require retry logic."
      );
      console.warn("Unprocessed:", response.UnprocessedItems);
    } else {
      console.log(
        `✅ Successfully seeded ${OHADA_ACCOUNTS.length} OHADA accounts and ${OHADA_JOURNALS.length} journals!\n`
      );
    }
  } catch (error) {
    console.error("❌ Error seeding accounts:", error);
    process.exit(1);
  }
}

// Execute if run directly
seedOhadaData().then(() => {
  console.log("✨ Seed complete!\n");
  process.exit(0);
});

// Cmd to run the script:
// ORG_ID=test-org-001 LOCALSTACK_URL=http://localhost:4566 TABLE_NAME=liass-ohada-dev-accounting-table npx ts-node ./scripts/seed-ohada-accounts.ts
