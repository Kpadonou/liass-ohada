import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { AppError } from "@/lambda/shared/app-error";
import {
  assertSafeSeedTarget,
  seedAccountingTestData,
  type SeedAccountingDependencies,
  type SeedAccountingOptions,
} from "../../../scripts/seed-accounting-test-data";

const options: SeedAccountingOptions = {
  orgId: "org-test",
  year: 2026,
  stage: "test",
  tableName: "liass-ohada-test-accounting-table",
  isLocal: false,
  writeConfirmed: true,
  userId: "seed-user",
  createPrerequisites: true,
  accountingFramework: "SYSCOHADA_REVISED",
  referencePath:
    "../../../../.agents/skills/ohada-legal-reference/references/syscohada-plan-comptable.md",
};

const accounts = [
  ["41110000", "Clients"],
  ["40110000", "Fournisseurs"],
  ["52110000", "Banques X"],
  ["60110000", "Achats de marchandises"],
  ["70110000", "Ventes de marchandises"],
  ["63280000", "Divers frais"],
].map(([accountId, accountName]) => ({
  accountId,
  accountName,
  accountNature:
    accountId.startsWith("6") || accountId.startsWith("7")
      ? ("INCOME" as const)
      : ("BALANCE" as const),
  accountUsage: "BOTH" as const,
  isThirdPartyAccount: accountId.startsWith("4"),
  classCode: Number(accountId[0]),
  financialStatementCode: `SYSCOHADA_CLASS_${accountId[0]}`,
  allowReconciliation: accountId.startsWith("4"),
  isActive: true,
}));

function dependencies(
  existingReferences: string[] = [],
): SeedAccountingDependencies {
  const stored = new Map(
    existingReferences.map((reference) => [
      `DEV-SEED-2026-${reference}`,
      {
        entryId: `DEV-SEED-2026-${reference}`,
        voucherNumber: reference,
        status: "POSTED",
      },
    ]),
  );
  const postEntry = jest.fn(async ({ data }) => {
    stored.set(data.entryId!, {
      entryId: data.entryId!,
      voucherNumber: data.voucherNumber,
      status: "POSTED",
    });
    return { entryId: data.entryId! };
  });

  return {
    getFiscalYear: jest.fn(async () => ({
      orgId: "org-test",
      year: 2026,
      fiscalYearId: "FY2026",
      startDate: "2026-01-01",
      endDate: "2026-12-31",
      status: "OPEN" as const,
      accountingFramework: "SYSCOHADA_REVISED" as const,
      entityType: "FISCAL_YEAR" as const,
      PK: "test-only",
      SK: "test-only",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    })),
    createFiscalYear: jest.fn(),
    listJournals: jest.fn(async () => [
      { year: 2026, journalCode: "VTE", journalName: "Ventes", type: "SALE" as const },
      { year: 2026, journalCode: "ACH", journalName: "Achats", type: "PURCHASE" as const },
      { year: 2026, journalCode: "BQ", journalName: "Banque", type: "BANK" as const },
      { year: 2026, journalCode: "OD", journalName: "OD", type: "MISC" as const },
    ]),
    createJournal: jest.fn(),
    listAccounts: jest.fn(async () => accounts),
    importAccounts: jest.fn(),
    getEntryDetail: jest.fn(async (_orgId, _year, entryId) => {
      const entry = stored.get(entryId);
      if (!entry) {
        throw new AppError(404, "ERROR_ENTRY_NOT_FOUND");
      }
      return entry;
    }),
    postEntry,
    listEntries: jest.fn(async () => [...stored.values()]),
    getGeneralLedger: jest.fn(async (_orgId, _year, accountId) => ({
      movements:
        accountId === "41110000"
          ? [{ reference: "FAC-2026-001" }, { reference: "ENC-2026-001" }]
          : [
              { reference: "ENC-2026-001" },
              { reference: "REG-2026-001" },
              { reference: "CHG-2026-001" },
            ],
    })),
    getTrialBalance: jest.fn(async () =>
      accounts.map((account) => ({
        accountId: account.accountId,
        movementDebit: 1,
        movementCredit: 1,
      })),
    ),
    getJournalEntries: jest.fn(async (_orgId, _year, journalCode) => {
      const references: Record<string, string[]> = {
        VTE: ["FAC-2026-001"],
        ACH: ["ACH-2026-001"],
        BQ: ["ENC-2026-001", "REG-2026-001"],
        OD: ["CHG-2026-001"],
      };
      return references[journalCode].map((reference) => ({ reference }));
    }),
  };
}

describe("accounting test-data seed", () => {
  test("rejects production and requires confirmation for non-local test", () => {
    expect(() =>
      assertSafeSeedTarget({
        stage: "prod",
        tableName: "liass-ohada-prod-accounting-table",
        isLocal: false,
        writeConfirmed: true,
      }),
    ).toThrow(/Only dev, test, or local/);

    expect(() =>
      assertSafeSeedTarget({
        stage: "test",
        tableName: "liass-ohada-test-accounting-table",
        isLocal: false,
        writeConfirmed: false,
      }),
    ).toThrow(/SEED_CONFIRM_WRITE=yes/);
  });

  test("posts through the existing workflow and maps admin expense to 6328", async () => {
    const deps = dependencies();
    const result = await seedAccountingTestData(options, deps);

    expect(deps.postEntry).toHaveBeenCalledTimes(5);
    expect(result.createdEntries).toEqual([
      "FAC-2026-001",
      "ENC-2026-001",
      "ACH-2026-001",
      "REG-2026-001",
      "CHG-2026-001",
    ]);
    expect(result.accountMappings).toContainEqual(
      expect.objectContaining({
        role: "administrativeExpense",
        requestedAccountId: "62210000",
        accountId: "63280000",
      }),
    );
    expect(deps.getGeneralLedger).toHaveBeenCalledWith(
      "org-test",
      2026,
      "41110000",
    );
    expect(deps.getJournalEntries).toHaveBeenCalledWith(
      "org-test",
      2026,
      "VTE",
    );
  });

  test("skips existing stable references", async () => {
    const references = [
      "FAC-2026-001",
      "ENC-2026-001",
      "ACH-2026-001",
      "REG-2026-001",
      "CHG-2026-001",
    ];
    const deps = dependencies(references);
    const result = await seedAccountingTestData(options, deps);

    expect(deps.postEntry).not.toHaveBeenCalled();
    expect(result.skippedExistingEntries).toEqual(references);
  });

  test("contains no Scan or hand-built persistence keys", () => {
    const source = readFileSync(
      resolve(__dirname, "../../../scripts/seed-accounting-test-data.ts"),
      "utf8",
    );

    expect(source).toContain("DEV/TEST ONLY");
    expect(source).not.toContain("ScanCommand");
    expect(source).toContain("LedgerService.postEntry");
    expect(source).not.toContain("KeyFactory");
    expect(source).not.toMatch(/\bPK\s*:/);
    expect(source).not.toMatch(/\bSK\s*:/);
  });
});
