import { dynamoClient } from "../lambda/shared/dynamo-client";
import { TransactWriteItemsCommand } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { KeyFactory } from "../lambda/shared/key-builder";
import { config } from "../lambda/shared/config";

async function seedTestEntries() {
  const orgId = "test-org-001";
  const tableName = config.TABLE_NAME;

  // On nettoie l'existant ou on utilise de nouveaux IDs pour éviter les conflits
  const entries = [
    // 1. ÉCRITURE D'OUVERTURE (Report à Nouveau)
    {
      year: 2024,
      entryId: "ENT-2024-OPEN",
      date: "2024-01-01",
      journalCode: "RAN", // Crucial pour la colonne "Ouverture"
      description: "Solde initial - Report 2023",
      lines: [
        { accountId: "52100000", debit: 5000, credit: 0 }, // Banque +5000
        { accountId: "10110000", debit: 0, credit: 5000 }, // Capital -5000
      ],
    },
    // 2. OPÉRATION COURANTE (Achat)
    {
      year: 2024,
      entryId: "ENT-2024-MOV",
      date: "2024-02-15",
      journalCode: "HA", // Journal d'Achats (Mouvement classique)
      description: "Achat de fournitures",
      lines: [
        { accountId: "60110000", debit: 1200, credit: 0 },
        { accountId: "52100000", debit: 0, credit: 1200 },
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
            entryId: entry.entryId, // Fix pour la référence "N/A"
            journalCode: entry.journalCode, // Pour la balance 6 colonnes
            description: entry.description,
            debit: line.debit,
            credit: line.credit,
            entryDate: entry.date,
            year: entry.year,
          }),
        },
      };
    });

    try {
      await dynamoClient.send(
        new TransactWriteItemsCommand({ TransactItems: transactItems })
      );
      console.log(`✅ Injecté: ${entry.entryId} (${entry.journalCode})`);
    } catch (err) {
      console.error(`❌ Erreur:`, err);
    }
  }
}

seedTestEntries();

// Cmd to run the script:
// ORG_ID=test-org-001 LOCALSTACK_URL=http://localhost:4566 TABLE_NAME=liass-ohada-dev-accounting-table npx ts-node ./scripts/seed-test-entries.ts
