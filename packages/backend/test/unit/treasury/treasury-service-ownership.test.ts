import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const backendRoot = path.join(__dirname, "../../..");
const treasuryServicePath = path.join(
  backendRoot,
  "lambda/domains/treasury/services/treasury-service.ts",
);
const accountingBoundaryPaths = [
  "lambda/domains/accounting/accounts/accounting-account-reference-service.ts",
  "lambda/domains/accounting/reconciliation/accounting-reconciliation-service.ts",
  "lambda/domains/accounting/posting/accounting-treasury-posting-service.ts",
];
const treasuryHandlers = [
  "cancel-reconciliation",
  "create-account",
  "get-summary",
  "import-statement-lines",
  "list-accounts",
  "list-movements",
  "list-reconciliations",
  "list-statement-lines",
  "post-transaction",
  "reconcile",
].map((handler) =>
  readFileSync(
    path.join(backendRoot, `lambda/domains/treasury/${handler}.ts`),
    "utf8",
  ),
);

describe("Treasury service ownership", () => {
  test("keeps the TreasuryService implementation in the Treasury domain", () => {
    expect(existsSync(treasuryServicePath)).toBe(true);
    expect(readFileSync(treasuryServicePath, "utf8")).toContain(
      "export class TreasuryService",
    );
  });

  test("does not retain a shared-path implementation or compatibility export", () => {
    expect(
      existsSync(
        path.join(backendRoot, "lambda/shared/services/treasury-service.ts"),
      ),
    ).toBe(false);
  });

  test("uses only the canonical Treasury-domain import from handlers", () => {
    const sources = treasuryHandlers.join("\n");
    expect(sources).not.toContain("shared/services/treasury-service");
    expect(sources).toContain("domains/treasury/services/treasury-service");
  });

  test("keeps the supported Accounting boundaries acyclic", () => {
    for (const boundaryPath of accountingBoundaryPaths) {
      const source = readFileSync(path.join(backendRoot, boundaryPath), "utf8");
      expect(source).not.toContain("TreasuryService");
      expect(source).not.toContain("domains/treasury/services/treasury-service");
    }
  });
});
