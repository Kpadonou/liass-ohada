/**
 * DEV/TEST ONLY.
 *
 * Seeds a small, idempotent set of posted accounting entries through the
 * production LedgerService posting workflow. This script never constructs
 * persistence keys and never uses Scan.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  type AccountDto,
  type CreateEntryRequest,
  type FiscalYear,
  type JournalDto,
} from "@liass-ohada/shared/accounting";

import { AppError } from "../lambda/shared/middleware/handler-wrapper";
import { BalanceService } from "../lambda/shared/services/balance-service";
import { FiscalYearService } from "../lambda/shared/services/fiscal-year-service";
import { JournalService } from "../lambda/shared/services/journal-service";
import { LedgerService } from "../lambda/shared/services/ledger-service";
import {
  SyscohadaAccountImportService,
  type SyscohadaReferenceAccount,
} from "../lambda/shared/services/syscohada-account-import-service";

const DEFAULT_ORG_ID = "org-0ca75a05-c547-4c26-8929-387f4fff94ce";
const DEFAULT_FISCAL_YEAR = 2026;
const DEFAULT_USER_ID = "dev-accounting-seed";
const DEFAULT_REFERENCE_PATH =
  "../../../.agents/skills/ohada-legal-reference/references/syscohada-plan-comptable.md";

const JOURNAL_DEFINITIONS = [
  { journalCode: "VTE", journalName: "Ventes", type: "SALE" as const },
  { journalCode: "ACH", journalName: "Achats", type: "PURCHASE" as const },
  { journalCode: "BQ", journalName: "Banque", type: "BANK" as const },
  { journalCode: "OD", journalName: "Opérations diverses", type: "MISC" as const },
];

const ACCOUNT_REQUIREMENTS = {
  customer: {
    requestedAccountId: "41110000",
    candidates: ["41110000"],
    purpose: "Clients",
  },
  supplier: {
    requestedAccountId: "40110000",
    candidates: ["40110000"],
    purpose: "Fournisseurs",
  },
  bank: {
    requestedAccountId: "52110000",
    candidates: ["52110000"],
    purpose: "Banque",
  },
  purchases: {
    requestedAccountId: "60110000",
    candidates: ["60110000"],
    purpose: "Achats de marchandises",
  },
  sales: {
    requestedAccountId: "70110000",
    candidates: ["70110000"],
    purpose: "Ventes de marchandises",
  },
  administrativeExpense: {
    requestedAccountId: "62210000",
    candidates: ["63280000", "62880000", "62210000"],
    purpose: "Frais administratifs",
  },
} as const;

type AccountRole = keyof typeof ACCOUNT_REQUIREMENTS;

export interface SeedAccountingOptions {
  orgId: string;
  year: number;
  stage: string;
  tableName: string;
  isLocal: boolean;
  writeConfirmed: boolean;
  userId: string;
  createPrerequisites: boolean;
  accountingFramework: "SYSCOHADA_REVISED" | "SYCEBNL";
  referencePath: string;
}

export interface SeedAccountingDependencies {
  getFiscalYear(orgId: string, year: number): Promise<FiscalYear>;
  createFiscalYear(
    orgId: string,
    userId: string,
    year: number,
    accountingFramework: "SYSCOHADA_REVISED" | "SYCEBNL",
  ): Promise<unknown>;
  listJournals(orgId: string): Promise<JournalDto[]>;
  createJournal(
    orgId: string,
    userId: string,
    input: {
      year: number;
      journalCode: string;
      journalName: string;
      type: "PURCHASE" | "SALE" | "BANK" | "MISC";
    },
  ): Promise<JournalDto>;
  listAccounts(orgId: string): Promise<AccountDto[]>;
  importAccounts(
    orgId: string,
    accounts: readonly SyscohadaReferenceAccount[],
  ): Promise<unknown>;
  getEntryDetail(orgId: string, year: number, entryId: string): Promise<{
    entryId: string;
    voucherNumber?: string;
    status: string;
  }>;
  postEntry(params: {
    orgId: string;
    userId: string;
    data: CreateEntryRequest;
  }): Promise<{ entryId: string }>;
  listEntries(
    orgId: string,
    year: number,
  ): Promise<Array<{ voucherNumber?: string; status: string }>>;
  getGeneralLedger(
    orgId: string,
    year: number,
    accountId: string,
  ): Promise<{ movements: Array<{ reference?: string }> }>;
  getTrialBalance(
    orgId: string,
    year: number,
  ): Promise<Array<{
    accountId: string;
    movementDebit: number;
    movementCredit: number;
  }>>;
  getJournalEntries(
    orgId: string,
    year: number,
    journalCode: string,
  ): Promise<Array<{ reference?: string }>>;
}

interface AccountMapping {
  role: AccountRole;
  requestedAccountId: string;
  accountId: string;
  accountName: string;
  purpose: string;
}

interface SeedEntry {
  entryId: string;
  voucherNumber: string;
  data: CreateEntryRequest;
}

export interface SeedAccountingResult {
  orgId: string;
  fiscalYear: number;
  stage: string;
  tableName: string;
  createdEntries: string[];
  skippedExistingEntries: string[];
  createdPrerequisites: string[];
  missingPrerequisites: string[];
  accountMappings: AccountMapping[];
  journalsUsed: string[];
  verification: {
    entries: string[];
    generalLedger: Record<string, string[]>;
    balanceAccounts: string[];
    journalBooks: Record<string, string[]>;
  };
}

export function assertSafeSeedTarget(options: {
  stage: string;
  tableName: string;
  isLocal: boolean;
  writeConfirmed: boolean;
}): void {
  const stage = options.stage.trim().toLowerCase();
  const tableName = options.tableName.trim().toLowerCase();

  if (!["dev", "test", "local"].includes(stage)) {
    throw new Error(
      `Refusing accounting seed for stage "${options.stage}". Only dev, test, or local are allowed.`,
    );
  }

  if (stage === "local" && !options.isLocal) {
    throw new Error(
      "Refusing local seed without LOCALSTACK_URL. Set LOCALSTACK_URL=http://localhost:4566.",
    );
  }

  if (tableName.includes("prod") || (!options.isLocal && !tableName.includes(`-${stage}-`))) {
    throw new Error(
      `Refusing accounting seed for table "${options.tableName}". The table name must match the non-production stage.`,
    );
  }

  if (!options.isLocal && stage !== "dev" && !options.writeConfirmed) {
    throw new Error(
      `Writing to stage "${options.stage}" requires SEED_CONFIRM_WRITE=yes.`,
    );
  }
}

export async function seedAccountingTestData(
  options: SeedAccountingOptions,
  dependencies: SeedAccountingDependencies = defaultDependencies,
): Promise<SeedAccountingResult> {
  assertSafeSeedTarget(options);

  const createdPrerequisites: string[] = [];
  await ensureFiscalYear(options, dependencies, createdPrerequisites);
  const journals = await ensureJournals(options, dependencies, createdPrerequisites);
  const accountMappings = await ensureAccounts(
    options,
    dependencies,
    createdPrerequisites,
  );
  const entries = buildSeedEntries(options.year, accountMappings);
  const createdEntries: string[] = [];
  const skippedExistingEntries: string[] = [];
  const existingEntries = await dependencies.listEntries(
    options.orgId,
    options.year,
  );
  const existingByReference = new Map(
    existingEntries
      .filter((entry) => entry.voucherNumber)
      .map((entry) => [entry.voucherNumber as string, entry]),
  );

  for (const entry of entries) {
    const existingReference = existingByReference.get(entry.voucherNumber);
    if (existingReference) {
      if (existingReference.status !== "POSTED") {
        throw new Error(
          `Reference ${entry.voucherNumber} already exists but is ${existingReference.status}.`,
        );
      }
      skippedExistingEntries.push(entry.voucherNumber);
      continue;
    }

    const existing = await findEntry(dependencies, options, entry.entryId);

    if (existing) {
      if (
        existing.status !== "POSTED" ||
        existing.voucherNumber !== entry.voucherNumber
      ) {
        throw new Error(
          `Seed entry id ${entry.entryId} already exists with incompatible status or reference.`,
        );
      }

      skippedExistingEntries.push(entry.voucherNumber);
      continue;
    }

    await dependencies.postEntry({
      orgId: options.orgId,
      userId: options.userId,
      data: entry.data,
    });
    createdEntries.push(entry.voucherNumber);
  }

  const verification = await verifySeed(
    options,
    dependencies,
    entries,
    accountMappings,
  );

  return {
    orgId: options.orgId,
    fiscalYear: options.year,
    stage: options.stage,
    tableName: options.tableName,
    createdEntries,
    skippedExistingEntries,
    createdPrerequisites,
    missingPrerequisites: [],
    accountMappings,
    journalsUsed: journals.map((journal) => journal.journalCode),
    verification,
  };
}

async function ensureFiscalYear(
  options: SeedAccountingOptions,
  dependencies: SeedAccountingDependencies,
  createdPrerequisites: string[],
): Promise<void> {
  try {
    const fiscalYear = await dependencies.getFiscalYear(options.orgId, options.year);

    if (fiscalYear.status !== "OPEN") {
      throw new Error(`Fiscal year ${options.year} exists but is ${fiscalYear.status}.`);
    }
  } catch (error) {
    if (!isNotFound(error) || !options.createPrerequisites) {
      throw prerequisiteError(
        `Open fiscal year ${options.year} is required`,
        error,
      );
    }

    await dependencies.createFiscalYear(
      options.orgId,
      options.userId,
      options.year,
      options.accountingFramework,
    );
    createdPrerequisites.push(`fiscal-year:${options.year}`);
  }
}

async function ensureJournals(
  options: SeedAccountingOptions,
  dependencies: SeedAccountingDependencies,
  createdPrerequisites: string[],
): Promise<JournalDto[]> {
  let journals = await dependencies.listJournals(options.orgId);
  const journalsByCode = new Map(
    journals.map((journal) => [journal.journalCode.toUpperCase(), journal]),
  );

  for (const definition of JOURNAL_DEFINITIONS) {
    const existing = journalsByCode.get(definition.journalCode);

    if (existing) {
      if (existing.year !== options.year) {
        throw new Error(
          `Journal ${definition.journalCode} exists for ${existing.year}, not ${options.year}.`,
        );
      }
      continue;
    }

    if (!options.createPrerequisites) {
      throw new Error(
        `Missing journal ${definition.journalCode}. Re-run with CREATE_PREREQUISITES=true or create it through the journal workflow.`,
      );
    }

    const created = await dependencies.createJournal(
      options.orgId,
      options.userId,
      { ...definition, year: options.year },
    );
    journalsByCode.set(created.journalCode, created);
    createdPrerequisites.push(`journal:${created.journalCode}`);
  }

  journals = [...journalsByCode.values()];
  return JOURNAL_DEFINITIONS.map((definition) => {
    const journal = journals.find(
      (candidate) => candidate.journalCode === definition.journalCode,
    );

    if (!journal) {
      throw new Error(`Journal ${definition.journalCode} is unavailable after setup.`);
    }

    return journal;
  });
}

async function ensureAccounts(
  options: SeedAccountingOptions,
  dependencies: SeedAccountingDependencies,
  createdPrerequisites: string[],
): Promise<AccountMapping[]> {
  let accounts = await dependencies.listAccounts(options.orgId);
  let activeAccounts = new Map(
    accounts
      .filter((account) => account.isActive)
      .map((account) => [account.accountId, account]),
  );
  const missingCandidateIds = unique(
    Object.values(ACCOUNT_REQUIREMENTS)
      .filter((requirement) =>
        !requirement.candidates.some((accountId) => activeAccounts.has(accountId)),
      )
      .map((requirement) => requirement.candidates[0]),
  );

  if (missingCandidateIds.length > 0 && options.createPrerequisites) {
    const markdown = readFileSync(resolve(__dirname, options.referencePath), "utf8");
    const references = SyscohadaAccountImportService.parseReference(markdown);
    const referencesById = new Map(
      references.map((reference) => [
        reference.accountNumber.padEnd(8, "0"),
        reference,
      ]),
    );
    const selectedReferences = missingCandidateIds
      .map((accountId) => referencesById.get(accountId))
      .filter((reference): reference is SyscohadaReferenceAccount => !!reference);

    await dependencies.importAccounts(options.orgId, selectedReferences);
    createdPrerequisites.push(
      ...selectedReferences.map(
        (reference) => `account:${reference.accountNumber.padEnd(8, "0")}`,
      ),
    );
    accounts = await dependencies.listAccounts(options.orgId);
    activeAccounts = new Map(
      accounts
        .filter((account) => account.isActive)
        .map((account) => [account.accountId, account]),
    );
  }

  return Object.entries(ACCOUNT_REQUIREMENTS).map(([role, requirement]) => {
    const account = requirement.candidates
      .map((accountId) => activeAccounts.get(accountId))
      .find((candidate): candidate is AccountDto => !!candidate);

    if (!account) {
      throw new Error(
        `Missing active account for ${requirement.purpose}. Tried ${requirement.candidates.join(", ")}.`,
      );
    }

    return {
      role: role as AccountRole,
      requestedAccountId: requirement.requestedAccountId,
      accountId: account.accountId,
      accountName: account.accountName,
      purpose: requirement.purpose,
    };
  });
}

function buildSeedEntries(
  year: number,
  mappings: AccountMapping[],
): SeedEntry[] {
  const account = (role: AccountRole) => {
    const mapping = mappings.find((candidate) => candidate.role === role);
    if (!mapping) {
      throw new Error(`Missing account mapping for ${role}.`);
    }
    return mapping.accountId;
  };
  const entry = (
    date: string,
    journalCode: string,
    voucherNumber: string,
    label: string,
    lines: CreateEntryRequest["lines"],
  ): SeedEntry => {
    const entryId = `DEV-SEED-${year}-${voucherNumber}`
      .toUpperCase()
      .replace(/[^A-Z0-9-]/g, "-");

    return {
      entryId,
      voucherNumber,
      data: {
        year,
        entryId,
        entryDate: date,
        journalCode,
        voucherNumber,
        entryType: "STANDARD",
        label,
        lines,
      },
    };
  };

  return [
    entry(`${year}-01-15`, "VTE", `FAC-${year}-001`, "Vente de marchandises", [
      { accountId: account("customer"), debit: 150000, credit: 0, label: "Clients" },
      { accountId: account("sales"), debit: 0, credit: 150000, label: "Ventes de marchandises" },
    ]),
    entry(`${year}-01-20`, "BQ", `ENC-${year}-001`, `Encaissement client FAC-${year}-001`, [
      { accountId: account("bank"), debit: 150000, credit: 0, label: "Banque" },
      { accountId: account("customer"), debit: 0, credit: 150000, label: "Clients" },
    ]),
    entry(`${year}-02-05`, "ACH", `ACH-${year}-001`, "Achat de marchandises", [
      { accountId: account("purchases"), debit: 80000, credit: 0, label: "Achats de marchandises" },
      { accountId: account("supplier"), debit: 0, credit: 80000, label: "Fournisseurs" },
    ]),
    entry(`${year}-02-12`, "BQ", `REG-${year}-001`, `Règlement fournisseur ACH-${year}-001`, [
      { accountId: account("supplier"), debit: 80000, credit: 0, label: "Fournisseurs" },
      { accountId: account("bank"), debit: 0, credit: 80000, label: "Banque" },
    ]),
    entry(`${year}-03-10`, "OD", `CHG-${year}-001`, "Frais administratifs", [
      { accountId: account("administrativeExpense"), debit: 25000, credit: 0, label: "Frais administratifs" },
      { accountId: account("bank"), debit: 0, credit: 25000, label: "Banque" },
    ]),
  ];
}

async function findEntry(
  dependencies: SeedAccountingDependencies,
  options: SeedAccountingOptions,
  entryId: string,
) {
  try {
    return await dependencies.getEntryDetail(options.orgId, options.year, entryId);
  } catch (error) {
    if (isNotFound(error)) {
      return null;
    }
    throw error;
  }
}

async function verifySeed(
  options: SeedAccountingOptions,
  dependencies: SeedAccountingDependencies,
  entries: SeedEntry[],
  mappings: AccountMapping[],
): Promise<SeedAccountingResult["verification"]> {
  const expectedReferences = entries.map((entry) => entry.voucherNumber);

  return retry(async () => {
    const listedEntries = await dependencies.listEntries(options.orgId, options.year);
    const listedReferences = listedEntries
      .filter((entry) => entry.status === "POSTED" && entry.voucherNumber)
      .map((entry) => entry.voucherNumber as string);
    assertContainsAll("entries list", listedReferences, expectedReferences);

    const ledgerAccounts = unique([
      accountForRole(mappings, "customer"),
      accountForRole(mappings, "bank"),
    ]);
    const generalLedger: Record<string, string[]> = {};
    for (const accountId of ledgerAccounts) {
      const ledger = await dependencies.getGeneralLedger(
        options.orgId,
        options.year,
        accountId,
      );
      generalLedger[accountId] = ledger.movements
        .map((movement) => movement.reference)
        .filter((reference): reference is string => !!reference);
    }
    assertContainsAll(
      "customer general ledger",
      generalLedger[accountForRole(mappings, "customer")],
      [`FAC-${options.year}-001`, `ENC-${options.year}-001`],
    );
    assertContainsAll(
      "bank general ledger",
      generalLedger[accountForRole(mappings, "bank")],
      [
        `ENC-${options.year}-001`,
        `REG-${options.year}-001`,
        `CHG-${options.year}-001`,
      ],
    );

    const balances = await dependencies.getTrialBalance(options.orgId, options.year);
    const affectedAccounts = unique(mappings.map((mapping) => mapping.accountId));
    const balanceAccounts = balances
      .filter(
        (balance) =>
          affectedAccounts.includes(balance.accountId) &&
          balance.movementDebit + balance.movementCredit > 0,
      )
      .map((balance) => balance.accountId);
    assertContainsAll("trial balance", balanceAccounts, affectedAccounts);

    const journalBooks: Record<string, string[]> = {};
    for (const journalCode of ["VTE", "ACH", "BQ", "OD"]) {
      const journalEntries = await dependencies.getJournalEntries(
        options.orgId,
        options.year,
        journalCode,
      );
      journalBooks[journalCode] = journalEntries
        .map((entry) => entry.reference)
        .filter((reference): reference is string => !!reference);
    }
    assertContainsAll("VTE journal book", journalBooks.VTE, [`FAC-${options.year}-001`]);
    assertContainsAll("BQ journal book", journalBooks.BQ, [
      `ENC-${options.year}-001`,
      `REG-${options.year}-001`,
    ]);

    return {
      entries: expectedReferences,
      generalLedger,
      balanceAccounts,
      journalBooks,
    };
  });
}

function accountForRole(mappings: AccountMapping[], role: AccountRole): string {
  const mapping = mappings.find((candidate) => candidate.role === role);
  if (!mapping) {
    throw new Error(`Missing account mapping for ${role}.`);
  }
  return mapping.accountId;
}

function assertContainsAll(
  label: string,
  actual: string[],
  expected: string[],
): void {
  const missing = expected.filter((value) => !actual.includes(value));
  if (missing.length > 0) {
    throw new Error(`${label} verification is missing: ${missing.join(", ")}`);
  }
}

async function retry<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < 6) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 400));
      }
    }
  }
  throw lastError;
}

function isNotFound(error: unknown): boolean {
  return (
    error instanceof AppError &&
    ["ERROR_ENTRY_NOT_FOUND", "ERROR_FISCAL_YEAR_NOT_FOUND"].includes(
      error.messageCode,
    )
  );
}

function prerequisiteError(message: string, cause: unknown): Error {
  const detail = cause instanceof Error ? `: ${cause.message}` : "";
  return new Error(`${message}${detail}`);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

async function listAllAccounts(orgId: string): Promise<AccountDto[]> {
  const accounts: AccountDto[] = [];
  let cursor: string | undefined;
  do {
    const result = await LedgerService.listAccounts(orgId, { cursor, limit: 200 });
    accounts.push(...result.accounts);
    cursor = result.nextCursor;
  } while (cursor);
  return accounts;
}

async function listAllEntries(orgId: string, year: number) {
  const entries: Array<{ voucherNumber?: string; status: string }> = [];
  let cursor: string | undefined;
  do {
    const result = await LedgerService.listEntries(orgId, {
      year: String(year),
      cursor,
      limit: 200,
    });
    entries.push(...result.entries);
    cursor = result.nextCursor;
  } while (cursor);
  return entries;
}

async function listAllJournalEntries(
  orgId: string,
  year: number,
  journalCode: string,
) {
  const entries: Array<{ reference?: string }> = [];
  let cursor: string | undefined;
  do {
    const result = await JournalService.getJournalEntries(orgId, {
      year: String(year),
      journalCode,
      cursor,
      limit: 200,
    });
    entries.push(...result.entries);
    cursor = result.nextCursor;
  } while (cursor);
  return entries;
}

const defaultDependencies: SeedAccountingDependencies = {
  getFiscalYear: (orgId, year) => LedgerService.getFiscalYear(orgId, year),
  createFiscalYear: (orgId, userId, year, accountingFramework) =>
    FiscalYearService.createFiscalYear(
      orgId,
      userId,
      { year },
      accountingFramework,
    ),
  listJournals: (orgId) => JournalService.listJournals(orgId),
  createJournal: (orgId, userId, input) =>
    JournalService.createJournal(orgId, userId, input),
  listAccounts: listAllAccounts,
  importAccounts: (orgId, accounts) =>
    SyscohadaAccountImportService.importAccounts(orgId, accounts),
  getEntryDetail: (orgId, year, entryId) =>
    LedgerService.getEntryDetail(orgId, year, entryId),
  postEntry: (params) => LedgerService.postEntry(params),
  listEntries: listAllEntries,
  getGeneralLedger: (orgId, year, accountId) =>
    LedgerService.getGeneralLedger(orgId, {
      fiscalYear: String(year),
      accountId,
      limit: 200,
    }),
  getTrialBalance: (orgId, year) => BalanceService.getTrialBalance(orgId, year),
  getJournalEntries: listAllJournalEntries,
};

function readOptions(): SeedAccountingOptions {
  const stage = process.env.STAGE ?? (process.env.LOCALSTACK_URL ? "local" : "");
  const tableName =
    process.env.TABLE_NAME ??
    (process.env.LOCALSTACK_URL ? "liass-ohada-dev-accounting-table" : "");

  if (!stage || !tableName) {
    throw new Error(
      "STAGE and TABLE_NAME are required unless LOCALSTACK_URL is configured.",
    );
  }

  return {
    orgId: process.env.ORG_ID ?? DEFAULT_ORG_ID,
    year: Number(process.env.FISCAL_YEAR ?? DEFAULT_FISCAL_YEAR),
    stage,
    tableName,
    isLocal: !!process.env.LOCALSTACK_URL,
    writeConfirmed: process.env.SEED_CONFIRM_WRITE === "yes",
    userId: process.env.SEED_USER_ID ?? DEFAULT_USER_ID,
    createPrerequisites: process.env.CREATE_PREREQUISITES !== "false",
    accountingFramework:
      process.env.ACCOUNTING_FRAMEWORK === "SYCEBNL"
        ? "SYCEBNL"
        : "SYSCOHADA_REVISED",
    referencePath: process.env.SYSCOHADA_REFERENCE ?? DEFAULT_REFERENCE_PATH,
  };
}

async function main(): Promise<void> {
  const options = readOptions();
  console.log(
    JSON.stringify(
      {
        warning: "DEV/TEST ACCOUNTING DATA WRITE",
        stage: options.stage,
        tableName: options.tableName,
        orgId: options.orgId,
        fiscalYear: options.year,
        local: options.isLocal,
      },
      null,
      2,
    ),
  );
  const result = await seedAccountingTestData(options);
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
