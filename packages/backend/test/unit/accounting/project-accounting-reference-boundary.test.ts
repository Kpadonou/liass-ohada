import { readFileSync } from "node:fs";
import path from "node:path";

const ledgerSource = readFileSync(
  path.join(__dirname, "../../../lambda/shared/services/ledger-service.ts"),
  "utf8",
);
const treasuryPostingSource = readFileSync(
  path.join(
    __dirname,
    "../../../lambda/domains/accounting/posting/accounting-treasury-posting-service.ts",
  ),
  "utf8",
);
const referenceBoundarySource = readFileSync(
  path.join(
    __dirname,
    "../../../lambda/domains/projects/references/project-accounting-reference-service.ts",
  ),
  "utf8",
);
const reportingBoundarySource = readFileSync(
  path.join(
    __dirname,
    "../../../lambda/domains/accounting/reporting/accounting-project-reporting-service.ts",
  ),
  "utf8",
);

describe("Accounting Core to Project Accounting reference boundary", () => {
  test("LedgerService uses only the Project Accounting-owned boundary", () => {
    expect(ledgerSource).toContain(
      'from "@/lambda/domains/projects/references/project-accounting-reference-service"',
    );
    const accountingPostingSources = `${ledgerSource}\n${treasuryPostingSource}`;
    for (const forbidden of [
      "BudgetService",
      "KeyFactory.projectSK",
      "KeyFactory.budgetLineSK",
      "KeyFactory.fundingSourceSK",
      "ProjectSchema",
      "DonorSchema",
      "BudgetLineSchema",
      "FundingSourceSchema",
    ]) {
      expect(accountingPostingSources).not.toContain(forbidden);
    }
  });

  test("keeps the two owner-controlled boundary implementations acyclic", () => {
    expect(referenceBoundarySource).not.toContain(
      "AccountingProjectReportingService",
    );
    expect(reportingBoundarySource).not.toContain(
      "ProjectAccountingReferenceService",
    );
  });
});
