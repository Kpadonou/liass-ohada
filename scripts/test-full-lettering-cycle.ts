import { handler as postEntry } from "../lambda/domains/core-ledger/entries/post-entry";
import { handler as getUnlettered } from "../lambda/domains/core-ledger/lettering/get-unlettered-lines";
import { handler as postLettering } from "../lambda/domains/core-ledger/lettering/post-lettering";
import { handler as cancelLettering } from "../lambda/domains/core-ledger/lettering/cancel-lettering";

const ORG_ID = "test-org-sycebnl";
const YEAR = 2026;

/** Utility to wait for LocalStack GSI indexing */
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function runFullLetteringTest() {
  console.log("🧪 DÉMARRAGE DU TEST COMPLET DU CYCLE DE LETTRAGE\n");

  const commonContext = {
    requestContext: { authorizer: { claims: { orgId: ORG_ID } } },
    headers: { "Accept-Language": "fr" },
  };

  // --- 1. CRÉATION DES ÉCRITURES ---
  console.log("1️⃣ Création des écritures (Facture et Paiement)...");

  const entries = [
    { label: "Facture F-001", debit: 5000, credit: 0 },
    { label: "Paiement P-001", debit: 0, credit: 5000 },
  ];

  for (const data of entries) {
    const res = await postEntry({
      ...commonContext,
      body: JSON.stringify({
        year: YEAR,
        entryDate: "2026-02-20",
        label: data.label,
        lines: [
          {
            accountId: "41110000",
            thirdPartyId: "DONOR-001",
            projectId: "PROJ-A",
            debit: data.debit,
            credit: data.credit,
          },
          {
            accountId: data.debit > 0 ? "75100000" : "52100000",
            debit: data.credit,
            credit: data.debit,
          },
        ],
      }),
    } as any);

    const body = JSON.parse(res.body);
    if (!body.success) {
      console.error(
        `❌ Échec création écriture (${data.label}):`,
        body.message || body.error,
      );
      return;
    }
  }

  console.log("   ⏳ Attente de l'indexation GSI (1.5s)...");
  await sleep(1500);

  // --- 2. RÉCUPÉRATION DES LIGNES ---
  console.log("2️⃣ Récupération des lignes non-lettrées...");
  const resSugg = await getUnlettered({
    ...commonContext,
    queryStringParameters: {
      orgId: ORG_ID,
      accountId: "41110000",
      thirdPartyId: "DONOR-001",
    },
  } as any);

  const bodySugg = JSON.parse(resSugg.body);
  const unletteredLines = bodySugg.data?.unletteredLines || [];

  if (unletteredLines.length < 2) {
    console.error(
      "❌ Erreur : Lignes non trouvées dans l'index GSI. Reçu :",
      bodySugg,
    );
    return;
  }
  console.log(`   ✅ ${unletteredLines.length} lignes trouvées.`);

  // --- 3. EXÉCUTION DU LETTRAGE ---
  console.log("3️⃣ Exécution du lettrage (Code 'AZ')...");
  const lineKeys = unletteredLines.map((l: any) => ({ PK: l.PK, SK: l.SK }));
  const resConfirm = await postLettering({
    ...commonContext,
    body: JSON.stringify({
      orgId: ORG_ID,
      year: YEAR,
      letteringCode: "AZ",
      lineKeys,
    }),
  } as any);

  const bodyConfirm = JSON.parse(resConfirm.body);
  if (!bodyConfirm.success) {
    console.error(
      "❌ Échec du lettrage:",
      bodyConfirm.message || bodyConfirm.error,
    );
    return;
  }
  console.log(
    `   ✅ Lettrage réussi (Statut: ${bodyConfirm.data.letteringStatus})`,
  );

  console.log("   ⏳ Attente mise à jour index (1s)...");
  await sleep(1000);

  // --- 4. VÉRIFICATION DISPARITION ---
  console.log("4️⃣ Vérification que les lignes sont masquées...");
  const resVerify = await getUnlettered({
    ...commonContext,
    queryStringParameters: {
      orgId: ORG_ID,
      accountId: "41110000",
      thirdPartyId: "DONOR-001",
    },
  } as any);
  const remaining =
    JSON.parse(resVerify.body).data?.unletteredLines?.length || 0;

  if (remaining === 0) {
    console.log("   ✅ Les lignes ont bien disparu des suggestions.");
  } else {
    console.error(`   ❌ Échec : ${remaining} lignes sont toujours visibles.`);
  }

  // --- 5. ANNULATION (DÉ-LETTRAGE) ---
  console.log("5️⃣ Annulation du lettrage (Dé-lettrage)...");
  const resCancel = await cancelLettering({
    ...commonContext,
    body: JSON.stringify({ orgId: ORG_ID, year: YEAR, lineKeys }),
  } as any);

  if (!JSON.parse(resCancel.body).success) {
    console.error("❌ Échec du dé-lettrage.");
    return;
  }
  console.log("   ✅ Dé-lettrage réussi.");

  console.log("   ⏳ Attente mise à jour index (1s)...");
  await sleep(1000);

  // --- 6. VÉRIFICATION FINALE ---
  console.log("6️⃣ Vérification du retour en suggestions...");
  const resFinal = await getUnlettered({
    ...commonContext,
    queryStringParameters: {
      orgId: ORG_ID,
      accountId: "41110000",
      thirdPartyId: "DONOR-001",
    },
  } as any);
  const finalCount =
    JSON.parse(resFinal.body).data?.unletteredLines?.length || 0;

  if (finalCount === 2) {
    console.log("\n✨ TEST RÉUSSI : Le cycle complet est validé.");
  } else {
    console.error(`\n❌ ÉCHEC : Attendu 2 lignes, trouvé ${finalCount}`);
  }
}

runFullLetteringTest().catch(console.error);
