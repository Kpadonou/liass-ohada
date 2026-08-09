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
const accountingBoundarySource = readFileSync(
  path.join(
    __dirname,
    "../../../lambda/domains/accounting/accounts/accounting-account-reference-service.ts",
  ),
  "utf8",
);

describe("Treasury Accounting account-reference boundary", () => {
  test("Treasury consumes only the supported Accounting account-reference boundary", () => {
    expect(treasuryProductionSource).toContain(
      'from "@/lambda/domains/accounting/accounts/accounting-account-reference-service"',
    );
    expect(treasuryProductionSource).not.toContain(
      'from "@liass-ohada/shared/accounting"',
    );
    expect(treasuryProductionSource).not.toMatch(/\bAccountSchema\.parse/);
    expect(treasuryProductionSource).not.toContain("KeyFactory.accountSK");
    expect(treasuryProductionSource).not.toMatch(
      /account(?:ing)?-account-repository/,
    );
  });

  test("Accounting Core retains account persistence parsing and key construction", () => {
    expect(accountingBoundarySource).toContain("AccountSchema.parse");
    expect(accountingBoundarySource).toContain("KeyFactory.accountSK");
    expect(accountingBoundarySource).toContain("GetItemCommand");
  });
});
