import { handler as lockPeriod } from "@/lambda/domains/core-ledger/fiscal-year/lock-period";
import { handler as postEntry } from "@/lambda/domains/core-ledger/entries/post-entry";

const ORG_ID = "org-test-dash";
const YEAR = 2026;
const MONTH = 2; // Février

async function runLockEnforcementTest() {
  console.log("🔒 TEST DE PROTECTION DES PÉRIODES CLOSES\n");

  const commonContext = {
    requestContext: { authorizer: { claims: { orgId: ORG_ID } } },
    headers: { "Accept-Language": "fr" },
  };

  // --- ÉTAPE 1 : Verrouiller la période ---
  console.log(`1️⃣ Verrouillage de la période ${MONTH}/${YEAR}...`);
  await lockPeriod({
    ...commonContext,
    body: JSON.stringify({ year: YEAR, month: MONTH, status: "LOCKED" }),
  } as any);
  console.log("   ✅ Période verrouillée en base.\n");

  // --- ÉTAPE 2 : Tenter de poster une écriture dans cette période ---
  console.log(
    "2️⃣ Tentative d'écriture dans le mois verrouillé (Action interdite)...",
  );

  const res = await postEntry({
    ...commonContext,
    body: JSON.stringify({
      year: YEAR,
      entryDate: "2026-02-15", // Date en plein dans le verrou
      label: "Tentative d'intrusion",
      lines: [
        {
          accountId: "41110000",
          thirdPartyId: "DONOR-001",
          projectId: "PRJ-A",
          debit: 100,
          credit: 0,
        },
        { accountId: "75100000", debit: 0, credit: 100 },
      ],
    }),
  } as any);

  const body = JSON.parse(res.body);

  // --- ÉTAPE 3 : Analyse du résultat ---
  // On force la conversion en string pour éviter le crash .includes()
  const errorRaw = body.message || body.error || JSON.stringify(body) || "";
  const errorMessage = String(errorRaw);

  if (
    !body.success &&
    (res.statusCode === 400 || errorMessage.toLowerCase().includes("verrou"))
  ) {
    console.log(
      "\n✨ TEST RÉUSSI : Le système a bloqué l'écriture comme prévu !",
    );
    console.log(`   Message reçu : "${errorMessage}"`);
  } else {
    console.error(
      "\n❌ ÉCHEC DU TEST : L'écriture a été acceptée ou l'erreur n'est pas celle attendue.",
    );
    console.log("Status Code :", res.statusCode);
    console.log("Détails de la réponse :", body);
  }

  // --- NETTOYAGE (Optionnel) : Réouvrir la période ---
  await lockPeriod({
    ...commonContext,
    body: JSON.stringify({ year: YEAR, month: MONTH, status: "OPEN" }),
  } as any);
}

runLockEnforcementTest().catch(console.error);
