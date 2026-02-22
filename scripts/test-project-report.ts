import { handler } from "../lambda/domains/projects/get-project-report";
import { APIGatewayProxyEvent } from "aws-lambda";

async function runHybridTest() {
  console.log("--- Test du Rapport Projet Hybride (Annuel vs Global) ---");

  const orgId = "org-test-sycebnl";
  const projectId = "PRJ-2026-WASH-001";

  const event = {
    headers: { "Accept-Language": "fr" },
    pathParameters: { projectId },
    queryStringParameters: { year: "2026" }, // On teste spécifiquement 2026
    requestContext: {
      authorizer: { claims: { orgId } },
    },
  } as unknown as APIGatewayProxyEvent;

  const result = await handler(event);
  const response = JSON.parse(result.body);

  if (result.statusCode !== 200) {
    console.error("❌ Erreur API :", response);
    return;
  }

  const { data } = response;

  console.log(`\n📊 PROJET : ${data.projectInfo.name}`);
  console.log(`-----------------------------------------------`);

  // 💰 RÉINTÉGRATION DES CHIFFRES CLÉS (Global)
  console.log(
    `💰 RESSOURCES (Financements) : ${data.terSummary.totalRessources.toLocaleString()} XOF`,
  );
  console.log(
    `💸 EMPLOIS (Dépenses)        : ${data.terSummary.totalEmplois.toLocaleString()} XOF`,
  );
  console.log(
    `📊 POSITION NETTE            : ${data.terSummary.netPosition.toLocaleString()} XOF`,
  );
  console.log(`-----------------------------------------------`);

  // 📅 VUE ANNUELLE (Budget Performance)
  const annual = data.budgetPerformance.annual; // <-- Changement ici
  console.log(`📅 EXERCICE ${annual.year} :`); // <-- On utilise 'year' et non 'fiscalYear'
  console.log(`   Budget Annuel : ${annual.budget.toLocaleString()} XOF`);
  console.log(`   Dépenses      : ${annual.spent.toLocaleString()} XOF`);
  console.log(`   Taux Exéc.    : ${annual.executionRate.toFixed(2)}%`);

  // 🌎 VUE GLOBALE
  const global = data.budgetPerformance.global;
  console.log(`\n🌎 STATUT GLOBAL (LTD) :`);
  console.log(`   Budget Total  : ${global.totalBudget.toLocaleString()} XOF`);
  console.log(`   Taux Exéc.    : ${global.executionRate.toFixed(2)}%`);

  // 🔍 DÉTAILS PAR COMPTE
  console.log(`\n🔍 DÉTAILS PAR COMPTE :`);
  data.details.forEach((acc: any) => {
    console.log(
      `   - Compte ${acc.accountId}: D=${acc.debit.toLocaleString()} / C=${acc.credit.toLocaleString()} (Bal: ${acc.balance.toLocaleString()})`,
    );
  });
  console.log(`===============================================`);
}

runHybridTest().catch(console.error);
