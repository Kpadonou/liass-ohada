import { BatchWriteItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { padAccountNumber } from "../models/core-ledger/account";
import { KeyFactory } from "../lambda/shared/key-builder";
import { dynamoClient } from "../lambda/shared/dynamo-client";
import { config } from "../lambda/shared/config";

interface SeedAccount {
  accountNumber: string;
  accountName: string;
  accountNature: "BALANCE" | "INCOME";
  accountUsage: "DEBIT_ONLY" | "CREDIT_ONLY" | "BOTH";
  financialStatementCode: string;
  allowReconciliation?: boolean;
}

/**
 * Base OHADA Chart of Accounts (Plan de Comptes)
 * Supports SYSCOHADA General (Commercial) standard
 */
const OHADA_ACCOUNTS: SeedAccount[] = [
  // Class 1: Capital and Reserves
  {
    accountNumber: "1011",
    accountName: "Capital social",
    accountNature: "BALANCE",
    accountUsage: "BOTH",
    financialStatementCode: "B01",
    allowReconciliation: false,
  },

  // Class 2: Fixed Assets
  {
    accountNumber: "2411",
    accountName: "Matériel et outillage",
    accountNature: "BALANCE",
    accountUsage: "DEBIT_ONLY",
    financialStatementCode: "B02",
    allowReconciliation: false,
  },

  // Class 4: Third Parties
  {
    accountNumber: "4011",
    accountName: "Fournisseurs",
    accountNature: "BALANCE",
    accountUsage: "CREDIT_ONLY",
    financialStatementCode: "B03",
    allowReconciliation: true,
  },
  {
    accountNumber: "4111",
    accountName: "Clients",
    accountNature: "BALANCE",
    accountUsage: "DEBIT_ONLY",
    financialStatementCode: "B04",
    allowReconciliation: true,
  },

  // Class 5: Financial Assets
  {
    accountNumber: "521",
    accountName: "Banque",
    accountNature: "BALANCE",
    accountUsage: "BOTH",
    financialStatementCode: "B05",
    allowReconciliation: true,
  },
  {
    accountNumber: "571",
    accountName: "Caisse",
    accountNature: "BALANCE",
    accountUsage: "BOTH",
    financialStatementCode: "B06",
    allowReconciliation: true,
  },

  // Class 6: Purchase/Cost Accounts
  {
    accountNumber: "6011",
    accountName: "Achats de marchandises",
    accountNature: "INCOME",
    accountUsage: "DEBIT_ONLY",
    financialStatementCode: "I01",
    allowReconciliation: false,
  },

  // Class 7: Revenue Accounts
  {
    accountNumber: "7011",
    accountName: "Ventes de marchandises",
    accountNature: "INCOME",
    accountUsage: "CREDIT_ONLY",
    financialStatementCode: "I02",
    allowReconciliation: false,
  },
];

/**
 * Extract class code from account number (first digit)
 */
const getClassCode = (accountNumber: string): number => {
  return parseInt(accountNumber.charAt(0), 10);
};

/**
 * Seed OHADA chart of accounts for an organization
 */
async function seedOhadaAccounts(): Promise<void> {
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
      const accountNumber = seedAccount.accountNumber;
      const accountId = padAccountNumber(accountNumber);
      const classCode = getClassCode(accountNumber);

      const accountData = {
        orgId,
        accountNumber,
        accountId,
        accountName: seedAccount.accountName,
        accountNature: seedAccount.accountNature,
        accountUsage: seedAccount.accountUsage,
        isThirdPartyAccount: false,
        classCode,
        financialStatementCode: seedAccount.financialStatementCode,
        allowReconciliation: seedAccount.allowReconciliation ?? false,
        entityType: "ACCOUNT",
        pk: KeyFactory.orgKey(orgId),
        sk: KeyFactory.accountSK(accountId),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      requestItems[tableName].push({
        PutRequest: {
          Item: marshall(accountData, { removeUndefinedValues: true }),
        },
      });

      console.log(
        `✓ ${accountNumber.padEnd(6)} | ${accountData.accountName.padEnd(
          35
        )} | Class ${classCode} | ${accountData.accountNature.padEnd(6)} | ${
          accountData.accountUsage
        }`
      );
    }

    // Execute batch write
    console.log(
      `\n📝 Writing ${OHADA_ACCOUNTS.length} accounts to DynamoDB...\n`
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
        `✅ Successfully seeded ${OHADA_ACCOUNTS.length} OHADA accounts!\n`
      );
    }
  } catch (error) {
    console.error("❌ Error seeding accounts:", error);
    process.exit(1);
  }
}

// Execute if run directly
seedOhadaAccounts().then(() => {
  console.log("✨ Seed complete!\n");
  process.exit(0);
});
