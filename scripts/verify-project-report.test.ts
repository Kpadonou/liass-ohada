import { QueryCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { dynamoClient } from "../lambda/shared/dynamo-client";
import { config } from "../lambda/shared/config";
import { KeyFactory } from "../lambda/shared/key-builder";

/**
 * Simule la logique du rapport TER en interrogeant le GSI4.
 * Vérifie que les 150 000 XOF sont bien présents.
 */
async function verifyReport() {
  const orgId = "org-test-sycebnl";
  const projectId = "PRJ-2026-WASH-001";
  const year = 2026;

  console.log(
    `--- Vérification du Rapport TER pour le Projet: ${projectId} ---`,
  );

  try {
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: config.TABLE_NAME,
        IndexName: "GSI_PROJECT", // Ton index analytique
        KeyConditionExpression:
          "GSI4PK = :pk AND begins_with(GSI4SK, :skPrefix)",
        ExpressionAttributeValues: {
          ":pk": { S: KeyFactory.gsi4PK(orgId) },
          ":skPrefix": { S: `FY#${year}` },
        },
      }),
    );

    const lines = (result.Items || []).map((item) => unmarshall(item));

    // Calcul de l'agrégation (Emplois)
    const totalExpenditure = lines.reduce(
      (sum, line) => sum + (line.debit || 0),
      0,
    );

    console.log(`Nombre de lignes trouvées: ${lines.length}`);
    console.log(`Total des dépenses (Emplois): ${totalExpenditure} XOF`);

    if (totalExpenditure === 150000) {
      console.log("✅ TEST FINAL RÉUSSI : Le rapport TER est à jour !");
    } else {
      console.log("⚠️ ÉCART DÉTECTÉ : Le montant ne correspond pas.");
    }
  } catch (error) {
    console.error("Erreur lors de la lecture du rapport:", error);
  }
}

verifyReport();
