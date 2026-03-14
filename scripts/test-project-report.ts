import { handler } from "../lambda/domains/projects/get-project-report"; // Ajuste le chemin si nécessaire
import { APIGatewayProxyEvent } from "aws-lambda";

async function runTerTest() {
  const projectId = "EDU-002";
  const orgId = "org-test-dash";

  console.log(`\n📊 TEST DU TER HYBRIDE - Projet: ${projectId}`);
  console.log("===============================================");

  const event = {
    pathParameters: { projectId },
    queryStringParameters: { year: "2026" },
    headers: { "Accept-Language": "fr" },
    requestContext: {
      authorizer: {
        claims: { orgId: orgId },
      },
    },
  } as unknown as APIGatewayProxyEvent;

  const result = await handler(event);
  const response = JSON.parse(result.body);

  if (!response.success) {
    console.error("❌ Erreur lors de la génération du rapport :");
    console.error(response.message);
    return;
  }

  const data = response.data;

  // 1. En-tête du Rapport
  console.log(`PROJET : ${data.projectInfo.name} (${data.projectInfo.code})`);
  console.log(`BAILLEUR : ${data.projectInfo.donor}`);
  console.log(`-----------------------------------------------`);

  // 2. Résumé Financier (TER Summary)
  console.log("\n💰 RÉSUMÉ DES FLUX (GLOBAL) :");
  console.table({
    "Total Ressources (Financements)": `${data.terSummary.totalRessources.toLocaleString()} XOF`,
    "Total Emplois (Dépenses)": `${data.terSummary.totalEmplois.toLocaleString()} XOF`,
    "Position Nette (Cash)": `${data.terSummary.netPosition.toLocaleString()} XOF`,
  });

  // 3. Performance Budgétaire
  console.log("\n📈 PERFORMANCE BUDGÉTAIRE :");
  console.table({
    "Annuel (2026)": {
      Budget: data.budgetPerformance.annual.budget.toLocaleString(),
      Dépensé: data.budgetPerformance.annual.spent.toLocaleString(),
      Taux: `${data.budgetPerformance.annual.executionRate.toFixed(2)}%`,
    },
    "Global Projet": {
      Budget: data.budgetPerformance.global.totalBudget.toLocaleString(),
      Dépensé: data.budgetPerformance.global.totalSpent.toLocaleString(),
      Taux: `${data.budgetPerformance.global.executionRate.toFixed(2)}%`,
    },
  });

  // 4. Détails par Compte
  console.log("\n🔍 DÉTAILS COMPTABLES PAR NATURE :");
  console.table(
    data.details.map((d: any) => ({
      Compte: d.accountId,
      Débit: d.debit.toLocaleString(),
      Crédit: d.credit.toLocaleString(),
      SoldeOHADA: d.formattedBalance,
    })),
  );
}

runTerTest().catch(console.error);
