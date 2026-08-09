import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const treasuryServicePath = path.join(
  __dirname,
  "../../../lambda/domains/treasury/services/treasury-service.ts",
);
const treasuryDomainPath = path.join(
  __dirname,
  "../../../lambda/domains/treasury",
);
const treasuryProductionSource = [
  treasuryServicePath,
  ...readdirSync(treasuryDomainPath)
    .filter((fileName) => fileName.endsWith(".ts"))
    .map((fileName) => path.join(treasuryDomainPath, fileName)),
]
  .map((filePath) => readFileSync(filePath, "utf8"))
  .join("\n");
const accountingPostingBoundarySource = readFileSync(
  path.join(
    __dirname,
    "../../../lambda/domains/accounting/posting/accounting-treasury-posting-service.ts",
  ),
  "utf8",
);

describe("Treasury transaction Accounting posting boundary", () => {
  test("Treasury consumes the supported Accounting posting boundary only", () => {
    expect(treasuryProductionSource).toContain(
      'from "@/lambda/domains/accounting/posting/accounting-treasury-posting-service"',
    );
    expect(treasuryProductionSource).not.toContain("LedgerService");
    expect(treasuryProductionSource).not.toMatch(/\bEntrySchema\b/);
    expect(treasuryProductionSource).not.toMatch(/\bEntryLineSchema\b/);
    expect(treasuryProductionSource).not.toContain(
      'from "@liass-ohada/shared/accounting"',
    );
    expect(treasuryProductionSource).not.toMatch(
      /KeyFactory\.(entrySK|entryLineSK|gsi5Journal|journalBook)/,
    );
  });

  test("Accounting Core retains entry mapping and LedgerService invocation", () => {
    expect(accountingPostingBoundarySource).toContain("LedgerService.postEntry");
    expect(accountingPostingBoundarySource).toContain(
      'entryType: "STANDARD"',
    );
    expect(accountingPostingBoundarySource).toContain(
      "lines: [treasuryLine, counterpartyLine]",
    );
    expect(accountingPostingBoundarySource).toContain(
      "AccountingTreasuryPostingIdempotencyRepository.getCompleted",
    );
    expect(accountingPostingBoundarySource).toContain(
      "treasuryPostingIdempotency: identity",
    );
  });
});
