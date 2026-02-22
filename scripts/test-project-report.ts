import { handler } from "../lambda/domains/projects/get-project-report";
import { APIGatewayProxyEvent } from "aws-lambda";

/**
 * Test de génération du rapport TER (Tableau des Emplois et Ressources).
 * Vérifie l'agrégation correcte des débits (Emplois) et crédits (Ressources).
 */
async function testGetReport() {
  console.log("--- Test du Handler GetProjectReport ---");

  // Note : orgId doit correspondre à celui utilisé lors du flux-funding et post-entry
  const orgId = "org-test-sycebnl";
  const projectId = "PRJ-2026-WASH-001";

  const event = {
    headers: { "Accept-Language": "fr" },
    pathParameters: {
      projectId: projectId,
    },
    requestContext: {
      authorizer: {
        claims: { orgId: orgId },
      },
    },
  } as unknown as APIGatewayProxyEvent;

  try {
    const result = await handler(event);
    const body = JSON.parse(result.body);

    if (result.statusCode === 200) {
      const { terSummary, budgetExecution, details, projectInfo } = body.data;

      console.log(`\n✅ RAPPORT RÉCUPÉRÉ : ${projectInfo.name}`);
      console.log(`-----------------------------------------------`);
      console.log(
        `💰 RESSOURCES (Financements) : ${terSummary.totalRessources} XOF`,
      );
      console.log(
        `💸 EMPLOIS (Dépenses)        : ${terSummary.totalEmplois} XOF`,
      );
      console.log(
        `📊 POSITION NETTE            : ${terSummary.netPosition} XOF`,
      );
      console.log(`-----------------------------------------------`);
      console.log(
        `📈 EXÉCUTION BUDGÉTAIRE      : ${budgetExecution.percentage.toFixed(2)}%`,
      );
      console.log(
        `📉 RESTE À DÉPENSER          : ${budgetExecution.remaining} XOF`,
      );
      console.log(`-----------------------------------------------`);
      console.log(`🔍 DÉTAILS PAR COMPTE :`);
      details.forEach((acc: any) => {
        console.log(
          `   - Compte ${acc.accountId}: D=${acc.debit} / C=${acc.credit} (Bal: ${acc.balance})`,
        );
      });
      console.log(`===============================================\n`);
    } else {
      console.log("❌ ÉCHEC DU RAPPORT:", body);
    }
  } catch (error) {
    console.error("Erreur technique:", error);
  }
}

testGetReport();
