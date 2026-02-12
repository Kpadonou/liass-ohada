process.env.TABLE_NAME = "liass-ohada-dev-accounting-table";
process.env.LOCALSTACK_URL = "http://localhost:4566";

import { handler as postEntry } from "../lambda/domains/core-ledger/entries/post-entry";
import { handler as confirmLettering } from "../lambda/domains/core-ledger/transactions/post-lettering";
import { handler as getAuxiliaryLedger } from "../lambda/domains/core-ledger/queries/get-auxiliary-ledger";
import { handler as getSuggestions } from "../lambda/domains/core-ledger/queries/get-lettering-suggestions";

async function runReportTest() {
  console.log("📊 STARTING AUXILIARY LEDGER REPORT TEST");
  const commonContext = {
    requestContext: {
      authorizer: { claims: { orgId: "test-org-001", userId: "test-admin" } },
    },
    headers: { "Accept-Language": "fr" },
  };

  // 1️⃣ On crée les données (250 + 250) ET l'impayé (500)
  console.log("\n1️⃣ Creating entries...");
  await postEntry({
    ...commonContext,
    body: JSON.stringify({
      year: 2026,
      entryDate: "2026-02-11",
      label: "Invoice 250",
      lines: [
        { accountId: "41110000", thirdPartyId: "C-001", debit: 250, credit: 0 },
        { accountId: "701", debit: 0, credit: 250 },
      ],
    }),
  } as any);

  await postEntry({
    ...commonContext,
    body: JSON.stringify({
      year: 2026,
      entryDate: "2026-02-11",
      label: "Payment 250",
      lines: [
        { accountId: "521", debit: 250, credit: 0 },
        { accountId: "41110000", thirdPartyId: "C-001", debit: 0, credit: 250 },
      ],
    }),
  } as any);

  await postEntry({
    ...commonContext,
    body: JSON.stringify({
      year: 2026,
      entryDate: "2026-02-12",
      label: "Unpaid Invoice 500",
      lines: [
        { accountId: "41110000", thirdPartyId: "C-001", debit: 500, credit: 0 },
        { accountId: "701", debit: 0, credit: 500 },
      ],
    }),
  } as any);

  // 2️⃣ Récupération dynamique des lignes pour lettrage
  console.log("2️⃣ Fetching real lines to letter...");
  const suggRes = await getSuggestions({
    ...commonContext,
    queryStringParameters: {
      orgId: "test-org-001",
      accountId: "41110000",
      thirdPartyId: "C-001",
      year: "2026",
    },
  } as any);

  const suggestions = JSON.parse(suggRes.body).data.suggestions;
  const perfectMatch = suggestions.find((s: any) => s.type === "PERFECT_MATCH");

  if (perfectMatch) {
    console.log("✅ Match found, confirming lettering...");
    await confirmLettering({
      ...commonContext,
      body: JSON.stringify({
        orgId: "test-org-001",
        year: 2026,
        letteringCode: "B",
        lines: perfectMatch.lines.map((l: any) => ({
          lineId: l.lineId,
          debit: l.type === "DEBIT" ? l.amount : 0,
          credit: l.type === "CREDIT" ? l.amount : 0,
          currentLSk: l.currentLSk,
        })),
      }),
    } as any);
  }

  // 3️⃣ Génération du rapport
  console.log("\n3️⃣ Generating Auxiliary Ledger Report...");
  const reportRes = await getAuxiliaryLedger({
    ...commonContext,
    queryStringParameters: {
      orgId: "test-org-001",
      year: "2026",
      accountId: "41110000",
      thirdPartyId: "C-001",
    },
  } as any);

  const result = JSON.parse(reportRes.body);

  if (result.success) {
    const { summary, letteredGroups, unletteredLines } = result.data;

    console.log("\n📈 REPORT SUMMARY:");
    console.table(summary);

    console.log("\n✅ LETTERED GROUPS (History):");
    Object.keys(letteredGroups).forEach((code) => {
      console.log(`Group [${code}]:`);
      console.table(
        letteredGroups[code].map((l: any) => ({
          Date: l.entryDate,
          Label: l.label,
          Debit: l.debit,
          Credit: l.credit,
        }))
      );
    });

    console.log("\n❌ UNLETTERED LINES (Outstanding):");
    console.table(
      unletteredLines.map((l: any) => ({
        Date: l.entryDate,
        Label: l.label,
        Debit: l.debit,
        Credit: l.credit,
      }))
    );
  } else {
    console.error("❌ Failed to generate report:", result);
  }
}

runReportTest().catch(console.error);

/*LOCALSTACK_URL=http://localhost:4566 \
TABLE_NAME=liass-ohada-dev-accounting-table \
AWS_REGION=us-east-1 \
npx ts-node -r tsconfig-paths/register scripts/test-auxiliary-report.ts */
