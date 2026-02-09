import { handler as postEntry } from "../lambda/domains/core-ledger/entries/post-entry";
import { handler as getSuggestions } from "../lambda/domains/core-ledger/queries/get-lettering-suggestions";

const ORG = "test-org-001";
const ACC = "41110000";
const THIRD_PARTY = "CLIENT-KPADONOU";
const FY_ID = "FY#2026";
const STANDARD = "SYSCOHADA_GENERAL";

async function runTest() {
  console.log("🧪 DÉBUT DU TEST DE COMPTABILITÉ AUXILIAIRE");

  // Ces champs doivent être dans le BODY pour Zod
  const bodyBase = {
    orgId: ORG, // Ajouté ici car Zod le demande dans le schéma du body
    year: 2026,
    fiscalYearId: FY_ID,
    accountingStandard: STANDARD,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    currency: "XOF",
  };

  // Simulation du contexte d'authorizer (pour le handler)
  const requestContext = {
    authorizer: {
      claims: {
        orgId: ORG,
        sub: "test-user-001",
      },
    },
  };

  try {
    // 1. On crée une facture de 1000
    console.log("\n1️⃣ Enregistrement d'une facture de 1000...");
    const invRes = await postEntry({
      headers: { "Accept-Language": "fr" },
      body: JSON.stringify({
        ...bodyBase,
        entryDate: "2026-02-01",
        label: "Facture Client A",
        lines: [
          {
            accountId: ACC,
            thirdPartyId: THIRD_PARTY,
            debit: 1000,
            credit: 0,
            label: "Vente Client",
          },
          {
            accountId: "70100000",
            debit: 0,
            credit: 1000,
            label: "Vente Marchandises",
          },
        ],
      }),
      requestContext,
    } as any);

    if (invRes.statusCode >= 400) {
      console.error("Détail erreur facture:", invRes.body);
      throw new Error(`Facture failed with status ${invRes.statusCode}`);
    }

    // 2. On crée deux paiements de 500
    console.log("2️⃣ Enregistrement de deux paiements de 500...");
    for (const date of ["2026-02-05", "2026-02-06"]) {
      const payRes = await postEntry({
        headers: { "Accept-Language": "fr" },
        body: JSON.stringify({
          ...bodyBase,
          entryDate: date,
          label: `Paiement du ${date}`,
          lines: [
            { accountId: "52100000", debit: 500, credit: 0, label: "Banque" },
            {
              accountId: ACC,
              thirdPartyId: THIRD_PARTY,
              debit: 0,
              credit: 500,
              label: "Encaissement Client",
            },
          ],
        }),
        requestContext,
      } as any);

      if (payRes.statusCode >= 400) {
        console.error(`Détail erreur paiement ${date}:`, payRes.body);
        throw new Error(`Paiement failed with status ${payRes.statusCode}`);
      }
    }

    // 3. Appel du service de suggestion
    console.log("\n3️⃣ Appel du service suggest-lettering...");
    const result = await getSuggestions({
      queryStringParameters: {
        orgId: ORG,
        accountId: ACC,
        thirdPartyId: THIRD_PARTY,
      },
      headers: { "Accept-Language": "fr" },
      requestContext,
    } as any);

    const body = JSON.parse(result.body);

    if (result.statusCode >= 400) {
      console.error("❌ Erreur de suggestion:", body);
      return;
    }

    console.log("\n📊 RÉSULTATS : ");
    console.log(`Lignes non lettrées trouvées : ${body.data.totalUnlettered}`);
    console.log(`Nombre de suggestions : ${body.data.suggestionsFound}`);

    console.log("\n🔍 DÉTAIL DES SUGGESTIONS :");
    if (body.data.suggestions.length > 0) {
      console.table(
        body.data.suggestions.map((s: any) => ({
          Type: s.type,
          Montant: s.amount,
          Nb_Lignes: s.lines.length,
        }))
      );
    } else {
      console.log("Aucune suggestion générée.");
    }

    if (body.data.suggestionsFound >= 2) {
      console.log(
        "\n✅ SUCCÈS : Le FIFO a correctement lié les deux paiements à la facture !"
      );
    }
  } catch (error) {
    console.error("\n💥 ERREUR PENDANT LE TEST :");
    console.error(error);
  }
}

runTest();
