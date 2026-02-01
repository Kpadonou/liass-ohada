import { handler } from "../lambda/domains/core-ledger/ledger/get-account-ledger";

async function testLedger() {
  console.log("📖 TEST : Lecture du Grand Livre (Compte 52100000 - FY 2024)");
  console.log("-----------------------------------------------------------");

  const event = {
    headers: { "Accept-Language": "fr" },
    requestContext: {
      authorizer: {
        claims: { orgId: "test-org-001" },
      },
    },
    queryStringParameters: {
      fiscalYear: "2024",
      accountId: "52100000",
    },
  };

  try {
    const response = await handler(event as any);
    const body = JSON.parse(response.body);

    if (response.statusCode === 200) {
      console.log("✅ Données récupérées avec succès !");
      // console.table permet de voir le solde progressif s'ajuster par ligne
      console.table(body.data);

      const lastLine = body.data[body.data.length - 1];
      console.log("\n💰 Résumé :");
      console.log(`Nombre de mouvements : ${body.data.length}`);
      console.log(`Solde final : ${lastLine?.runningBalance || 0} €`);
    } else {
      console.error("❌ Erreur retournée par la Lambda :", body);
    }
  } catch (error) {
    console.error("💥 Erreur lors de l'exécution du test :", error);
  }
}

testLedger();
