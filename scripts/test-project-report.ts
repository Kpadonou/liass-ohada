import { handler as getReport } from "../lambda/domains/projects/get-project-report";
import { PutItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { dynamoClient } from "../lambda/shared/dynamo-client";
import { KeyFactory } from "../lambda/shared/key-builder";

/**
 * Test script for SYCEBNL Project Analytical Reporting.
 * Assumes Master Data (Org, FY) and Entries (Projet A) are already seeded.
 */

const ORG_ID = "test-org-sycebnl";
const PROJECT_A_ID = "PROJ-A";

async function setupProjectMetadata() {
  console.log("🏗️  Configuration des métadonnées du Projet A...");

  // On s'assure que le projet existe avec un budget pour tester l'exécution
  const now = new Date().toISOString();

  await dynamoClient.send(
    new PutItemCommand({
      TableName: "liass-ohada-dev-accounting-table",
      Item: marshall({
        PK: KeyFactory.orgKey(ORG_ID),
        SK: KeyFactory.projectSK(PROJECT_A_ID),
        orgId: ORG_ID, // Ajouté
        projectId: PROJECT_A_ID,
        projectCode: "PA-2026",
        name: "Projet de Santé Alpha",
        donorId: "DONOR-001",
        managerId: "MGR-001", // Ajouté
        budget: 5000000,
        currency: "XOF",
        status: "ACTIVE",
        startDate: "2026-01-01", // Ajouté
        entityType: "PROJECT",
        createdAt: now, // Ajouté
        updatedAt: now, // Ajouté
      }),
    }),
  );
  console.log("✅ Métadonnées du Projet A prêtes.");
}

async function runReportTest() {
  console.log("\n📊 DÉMARRAGE DU TEST DU RAPPORT ANALYTIQUE (TER)");

  const event = {
    requestContext: { authorizer: { claims: { orgId: ORG_ID } } },
    pathParameters: { projectId: PROJECT_A_ID },
    headers: { "Accept-Language": "fr" },
  } as any;

  try {
    const response = await getReport(event);
    const body = JSON.parse(response.body);

    if (!body.success) {
      console.error(
        "❌ ÉCHEC : Impossible de récupérer le rapport.",
        body.message,
      );
      return;
    }

    const report = body.data;

    console.log("\n--- Résultat du Rapport ---");
    console.log(
      `Projet : ${report.projectInfo.name} (${report.projectInfo.code})`,
    );
    console.log(
      `Total Emplois (Dépenses)    : ${report.terSummary.totalEmplois} XOF`,
    );
    console.log(
      `Total Ressources (Recettes) : ${report.terSummary.totalRessources} XOF`,
    );
    console.log(
      `Exécution Budgétaire        : ${report.budgetExecution.percentage}%`,
    );

    // Validations
    if (report.terSummary.totalEmplois > 0) {
      console.log(
        "✅ SUCCÈS : Les données comptables sont correctement agrégées via GSI4.",
      );
    } else {
      console.warn(
        "⚠️  ATTENTION : Le rapport est vide. Vérifie que les écritures ont bien été postées avec GSI4PK.",
      );
    }

    if (report.details.length > 0) {
      console.log(
        `✅ SUCCÈS : ${report.details.length} comptes trouvés dans la ventilation.`,
      );
    }
  } catch (error) {
    console.error("❌ ERREUR FATALE lors du test :", error);
  }
}

// Exécution
setupProjectMetadata().then(runReportTest).catch(console.error);

/* LOCALSTACK_URL=http://localhost:4566 \
TABLE_NAME=liass-ohada-dev-accounting-table \
AWS_REGION=us-east-1 \
npx ts-node -r tsconfig-paths/register scripts/test-project-report.ts */
