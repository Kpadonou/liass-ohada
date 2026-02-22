import { handler } from "../lambda/domains/core-ledger/entries/post-entry";
import { APIGatewayProxyEvent } from "aws-lambda";

/**
 * Script pour enregistrer un financement (Funding) pour le projet WASH.
 * Cela permet d'alimenter la partie "Ressources" du rapport TER.
 */
async function testProjectFundingFlow() {
  console.log("--- Démarrage du Flux de Financement (Ressources) ---");

  const orgId = "org-test-sycebnl";
  const projectId = "PRJ-2026-WASH-001";

  const event = {
    headers: { "Accept-Language": "fr" },
    requestContext: {
      authorizer: { claims: { orgId: orgId } },
    },
    body: JSON.stringify({
      year: 2026,
      entryDate: "2026-02-22",
      label: "Réception Subvention - Tranche 1 - Projet WASH",
      journalCode: "BQ", // Journal de Banque
      lines: [
        {
          accountId: "52110000", // Débit Banque : l'argent arrive
          label: "Versement Donateur - BOA",
          debit: 2000000,
          credit: 0,
          // Pas besoin de projectId ici (sauf si tu veux suivre le cash par projet)
        },
        {
          accountId: "70110000", // Crédit Revenus : la ressource du projet
          projectId: projectId, // Crucial pour le GSI4 (Ressources)
          label: "Subvention d'exploitation - WASH",
          debit: 0,
          credit: 2000000,
        },
      ],
    }),
  } as unknown as APIGatewayProxyEvent;

  try {
    const result = await handler(event);
    const body = JSON.parse(result.body);

    if (result.statusCode === 201) {
      console.log("✅ FINANCEMENT ENREGISTRÉ !");
      console.log(`Montant: 2 000 000 XOF versés sur le projet ${projectId}`);
    } else {
      console.log("❌ ÉCHEC:", body.error);
    }
  } catch (error) {
    console.error("Erreur d'exécution:", error);
  }
}

testProjectFundingFlow();

/* LOCALSTACK_URL=http://localhost:4566 TABLE_NAME=liass-ohada-dev-accounting-table AWS_REGION=us-east-1 npx ts-node -r tsconfig-paths/register scripts/flux-funding-projet.test.ts */
