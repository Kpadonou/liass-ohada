import { handler } from "../lambda/domains/projects/get-project-report";
import { APIGatewayProxyEvent } from "aws-lambda";

async function runTerTest() {
  const projectId = "EDU-002";
  const orgId = "org-test-dash";

  console.log(`\n📊 TEST DU RAPPORT HYBRIDE (SYCEBNL) - Projet: ${projectId}`);
  console.log("===========================================================");

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
    console.error("❌ ÉCHEC DU HANDLER");
    console.dir(response, { depth: null });
    return;
  }

  const data = response.data;

  // 1. En-tête du Rapport
  console.log(
    `\n🏢 PROJET  : ${data.projectInfo.name} (${data.projectInfo.code})`,
  );
  console.log(`🤝 BAILLEUR : ${data.projectInfo.donor}`);
  console.log(
    `📅 GÉNÉRÉ LE: ${new Date(data.metadata.generatedAt).toLocaleString()}`,
  );
  console.log(`-----------------------------------------------------------`);

  // 2. Résumé Financier Global (Position de Trésorerie)
  console.log("\n💰 RÉSUMÉ DES FLUX (GLOBAL) :");
  console.table({
    "Total Ressources (Financements)": `${data.financialPosition.totalRessources.toLocaleString()} XOF`,
    "Total Emplois (Dépenses)": `${data.financialPosition.totalEmplois.toLocaleString()} XOF`,
    "Position Nette (Cash)": `${data.financialPosition.netCash.toLocaleString()} XOF`,
  });

  // 3. Analyse Analytique (Prévu vs Réalisé par Ligne Budgétaire)
  // C'est ici que l'on voit si notre "pont" budgetLineId fonctionne
  if (data.budgetVsActual && data.budgetVsActual.length > 0) {
    console.log("\n📈 ANALYSE BUDGÉTAIRE (PILOTAGE PAR ACTIVITÉ) :");
    const budgetTable = data.budgetVsActual.map((b: any) => ({
      Code: b.code,
      Désignation: b.label,
      "Alloué (Budget)": b.allocated.toLocaleString() + " XOF",
      "Consommé (Réel)": b.spent.toLocaleString() + " XOF",
      Solde: b.remaining.toLocaleString() + " XOF",
      "% Exéc.": b.executionRate.toFixed(2) + "%",
    }));
    console.table(budgetTable);
  } else {
    console.log("\n⚠️ Aucune donnée budgétaire trouvée pour ce projet.");
  }

  // 4. Détails Comptables par Nature (Vue OHADA)
  console.log("\n🔍 DÉTAILS COMPTABLES (VUE PAR NATURE) :");
  const accountDetails = (data.accountDetails || data.details).map(
    (d: any) => ({
      Compte: d.accountId,
      Débit: d.debit.toLocaleString(),
      Crédit: d.credit.toLocaleString(),
      "Solde OHADA": d.formattedBalance,
    }),
  );
  console.table(accountDetails);
}

runTerTest().catch((err) => {
  console.error("💥 Erreur fatale lors de l'exécution du test :");
  console.error(err);
});
