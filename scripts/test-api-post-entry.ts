import { handler } from "../lambda/domains/core-ledger/entries/post-entry";

const mockEvent: any = {
  pathParameters: {}, // Non utilisé ici mais requis par la signature
  requestContext: {
    authorizer: {
      claims: {
        orgId: "test-org-001",
        userId: "user-admin-01",
      },
    },
  },
  headers: {
    "Accept-Language": "fr",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    year: "2026",
    entryDate: "2026-01-31",
    journalCode: "BQ", // Journal de Banque
    voucherNumber: "CHQ-8822",
    description: "Achat Fournitures Bureau",
    lines: [
      {
        accountId: "60110000", // Charges : Achat de fournitures
        debit: "50000",
        credit: "0",
        description: "Fournitures bureau",
      },
      {
        accountId: "52100000", // Actif : Banque
        debit: "0",
        credit: "50000",
        description: "Paiement par chèque",
      },
    ],
  }),
};

async function runTest() {
  console.log("📤 Envoi d'une nouvelle écriture...");
  try {
    const response = await handler(mockEvent);
    const body = JSON.parse(response.body);

    if (response.statusCode === 201) {
      console.log("✅ Succès !");
      console.log(`ID Écriture : ${body.data.entryId}`);
      console.log(`Total : ${body.data.totalDebit} FCFA`);
    } else {
      console.error("❌ Échec du test :");
      console.error(body);
    }
  } catch (error) {
    console.error("💥 Erreur lors de l'exécution du test :", error);
  }
}

runTest();
