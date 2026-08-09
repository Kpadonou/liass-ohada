import { readFileSync } from "node:fs";
import path from "node:path";

const treasuryServiceSource = readFileSync(
  path.join(
    __dirname,
    "../../../lambda/domains/treasury/services/treasury-service.ts",
  ),
  "utf8",
);
const accountingBoundarySource = readFileSync(
  path.join(
    __dirname,
    "../../../lambda/domains/accounting/reconciliation/accounting-reconciliation-service.ts",
  ),
  "utf8",
);

describe("Treasury reconciliation Accounting Core boundary", () => {
  test("Treasury consumes the supported Accounting reconciliation boundary", () => {
    expect(treasuryServiceSource).toContain(
      'from "@/lambda/domains/accounting/reconciliation/accounting-reconciliation-service"',
    );
  });

  test("Treasury no longer constructs or updates Accounting entry-line persistence", () => {
    expect(treasuryServiceSource).not.toContain("KeyFactory.entryLineSK");
    expect(treasuryServiceSource).not.toContain(
      "SET reconciliationStatus = :matched",
    );
    expect(treasuryServiceSource).not.toContain(
      "SET reconciliationStatus = :unmatched REMOVE statementLineId",
    );
    expect(treasuryServiceSource).not.toContain("BalanceService");
    expect(treasuryServiceSource).not.toContain(
      '"GSI1PK = :pk AND begins_with(GSI1SK, :sk)"',
    );
  });

  test("Accounting Core retains the reconciliation keys and mutation expressions", () => {
    expect(accountingBoundarySource).toContain("KeyFactory.entryLineSK");
    expect(accountingBoundarySource).toContain(
      "SET reconciliationStatus = :matched",
    );
    expect(accountingBoundarySource).toContain(
      "SET reconciliationStatus = :unmatched REMOVE statementLineId",
    );
    expect(accountingBoundarySource).toContain(
      "reconciliationMatchId = :expectedMatchId",
    );
  });
});
