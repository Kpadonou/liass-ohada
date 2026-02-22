// scripts/invoke-post-entry.ts
import { handler } from "../lambda/domains/core-ledger/entries/post-entry";
import { APIGatewayProxyEvent } from "aws-lambda";

async function invokeTest() {
  console.log("--- Démarrage de l'invocation directe du Handler ---");

  const orgId = "org-test-sycebnl"; // Doit correspondre à tes données en base

  const event = {
    headers: {
      "Accept-Language": "fr",
      "content-type": "application/json",
    },
    // Simulation structurelle complète pour éviter les undefined
    requestContext: {
      authorizer: {
        claims: { orgId: orgId },
      },
    },
    body: JSON.stringify({
      orgId: orgId, // On le met aussi dans le body par sécurité
      year: 2026,
      entryDate: "2026-02-21",
      label: "Loyer Bureau Projet WASH",
      journalCode: "GEN",
      lines: [
        {
          accountId: "62210000",
          projectId: "PRJ-2026-WASH-001",
          label: "Loyer Projet WASH",
          debit: 150000,
          credit: 0,
        },
        {
          accountId: "52110000",
          label: "Paiement Loyer - Chèque 887766",
          debit: 0,
          credit: 150000,
        },
      ],
    }),
  } as unknown as APIGatewayProxyEvent;

  try {
    const result = await handler(event);
    const body = JSON.parse(result.body);

    console.log("Statut:", result.statusCode);
    // On affiche l'objet complet pour voir l'erreur réelle de Zod si elle existe
    console.log("Réponse complète:", JSON.stringify(body, null, 2));
  } catch (error) {
    console.error("Erreur d'exécution:", error);
  }
}

invokeTest();
