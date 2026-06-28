/**
 * DEV/TEST ONLY.
 *
 * Seeds deterministic manual-lettering data through the production posting
 * workflow so GSI1/GSI2/GSI3 projections are populated by the same code path as
 * normal accounting entries. Prerequisite master-data items use KeyFactory for
 * every DynamoDB key and conditional writes for idempotency.
 */
import {
  GetItemCommand,
  TransactWriteItemsCommand,
  type TransactWriteItem,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import {
  AccountSchema,
  type Account,
  type CreateEntryRequest,
  type ThirdPartyTypeValue,
} from "@liass-ohada/shared/accounting";
import {
  OrganizationSchema,
  type Organization,
} from "@liass-ohada/shared";

import { config } from "../lambda/shared/config";
import { dynamoClient } from "../lambda/shared/dynamo-client";
import { KeyFactory } from "../lambda/shared/key-builder";
import { AppError } from "../lambda/shared/middleware/handler-wrapper";
import { CabinetDossierRepository } from "../lambda/shared/repositories/cabinet-dossier-repository";
import { OnboardingRepository } from "../lambda/shared/repositories/onboarding-repository";
import { FiscalYearService } from "../lambda/shared/services/fiscal-year-service";
import { JournalService } from "../lambda/shared/services/journal-service";
import { LedgerService } from "../lambda/shared/services/ledger-service";
import { LetteringService } from "../lambda/shared/services/lettering-service";
import { ThirdPartyService } from "../lambda/shared/services/third-party-service";
import { assertSafeSeedTarget } from "./seed-accounting-test-data";

const DEFAULT_USER_ID = "d10920ce-20e1-7069-ec61-0b67f3547aa6";
const DEFAULT_FISCAL_YEAR = 2026;

const JOURNALS = [
  { journalCode: "VT", journalName: "Ventes", type: "SALE" as const },
  { journalCode: "AC", journalName: "Achats", type: "PURCHASE" as const },
  { journalCode: "BQ", journalName: "Banque", type: "BANK" as const },
];

const ACCOUNTS = [
  {
    accountId: "41110000",
    accountName: "Clients",
    accountNature: "BALANCE" as const,
    accountUsage: "BOTH" as const,
    isThirdPartyAccount: true,
    requiresThirdParty: true,
    auxiliaryType: "CUSTOMER" as const,
    classCode: 4,
    financialStatementCode: "SYSCOHADA_CLASS_4",
    allowReconciliation: true,
  },
  {
    accountId: "40110000",
    accountName: "Fournisseurs",
    accountNature: "BALANCE" as const,
    accountUsage: "BOTH" as const,
    isThirdPartyAccount: true,
    requiresThirdParty: true,
    auxiliaryType: "SUPPLIER" as const,
    classCode: 4,
    financialStatementCode: "SYSCOHADA_CLASS_4",
    allowReconciliation: true,
  },
  {
    accountId: "70110000",
    accountName: "Ventes de marchandises",
    accountNature: "INCOME" as const,
    accountUsage: "BOTH" as const,
    isThirdPartyAccount: false,
    requiresThirdParty: false,
    auxiliaryType: "NONE" as const,
    classCode: 7,
    financialStatementCode: "SYSCOHADA_CLASS_7",
    allowReconciliation: false,
  },
  {
    accountId: "60110000",
    accountName: "Achats de marchandises",
    accountNature: "INCOME" as const,
    accountUsage: "BOTH" as const,
    isThirdPartyAccount: false,
    requiresThirdParty: false,
    auxiliaryType: "NONE" as const,
    classCode: 6,
    financialStatementCode: "SYSCOHADA_CLASS_6",
    allowReconciliation: false,
  },
  {
    accountId: "52110000",
    accountName: "Banque",
    accountNature: "BALANCE" as const,
    accountUsage: "BOTH" as const,
    isThirdPartyAccount: false,
    requiresThirdParty: false,
    auxiliaryType: "NONE" as const,
    classCode: 5,
    financialStatementCode: "SYSCOHADA_CLASS_5",
    allowReconciliation: false,
  },
];

const THIRD_PARTIES = [
  {
    thirdPartyId: "tp-cust-alpha",
    code: "CUST-ALPHA",
    type: "CUSTOMER" as const,
    displayName: "Client Alpha",
  },
  {
    thirdPartyId: "tp-sup-beta",
    code: "SUP-BETA",
    type: "SUPPLIER" as const,
    displayName: "Fournisseur Beta",
  },
];

interface ManualLetteringSeedOptions {
  orgId: string;
  orgName: string;
  targetDossierName?: string;
  cabinetId?: string;
  accountingFramework: string;
  year: number;
  stage: string;
  tableName: string;
  isLocal: boolean;
  writeConfirmed: boolean;
  userId: string;
}

interface SeedCounters {
  organizationsCreated: number;
  organizationAccessCreated: number;
  fiscalYearsCreated: number;
  journalsCreated: number;
  accountsCreated: number;
  thirdPartiesCreated: number;
  entriesCreated: number;
  skipped: {
    organizations: number;
    organizationAccess: number;
    fiscalYears: number;
    journals: number;
    accounts: number;
    thirdParties: number;
    entries: number;
  };
}

interface SeedEntry {
  entryId: string;
  voucherNumber: string;
  data: CreateEntryRequest;
}

interface CandidateSmoke {
  customerCandidateCount: number;
  supplierCandidateCount: number;
  customerReferences: string[];
  supplierReferences: string[];
  expectedCases: {
    customerFullMatchReady: boolean;
    customerPartialMatchReady: boolean;
    supplierFullMatchReady: boolean;
    mismatchProtectionLinesReady: boolean;
  };
  dtoTechnicalFieldsFound: string[];
}

interface ManualLetteringSeedResult {
  stage: string;
  tableName: string;
  orgId: string;
  orgName: string;
  targetDossierName?: string;
  cabinetId?: string;
  fiscalYear: number;
  journals: string[];
  accounts: string[];
  thirdParties: string[];
  entries: {
    created: string[];
    skippedExisting: string[];
  };
  counters: SeedCounters;
  smoke: CandidateSmoke;
}

export async function seedManualLetteringTestData(
  options: ManualLetteringSeedOptions,
): Promise<ManualLetteringSeedResult> {
  assertManualLetteringSeedTarget(options);

  const counters = emptyCounters();
  await verifySeedOrganization(options, counters);
  await ensureFiscalYear(options, counters);
  await ensureJournals(options, counters);
  await ensureAccounts(options, counters);
  await ensureThirdParties(options, counters);

  const entries = manualLetteringEntries(options.year);
  const created: string[] = [];
  const skippedExisting: string[] = [];
  const existingEntries = await listEntriesByReference(options.orgId, options.year);

  for (const entry of entries) {
    const existingReference = existingEntries.get(entry.voucherNumber);
    if (existingReference) {
      if (existingReference.status !== "POSTED") {
        throw new Error(
          `Reference ${entry.voucherNumber} already exists but is ${existingReference.status}.`,
        );
      }
      counters.skipped.entries += 1;
      skippedExisting.push(entry.voucherNumber);
      continue;
    }

    const existingById = await findEntry(options, entry.entryId);
    if (existingById) {
      if (
        existingById.status !== "POSTED" ||
        existingById.voucherNumber !== entry.voucherNumber
      ) {
        throw new Error(
          `Seed entry id ${entry.entryId} already exists with incompatible data.`,
        );
      }
      counters.skipped.entries += 1;
      skippedExisting.push(entry.voucherNumber);
      continue;
    }

    await LedgerService.postEntry({
      orgId: options.orgId,
      userId: options.userId,
      data: entry.data,
    });
    counters.entriesCreated += 1;
    created.push(entry.voucherNumber);
  }

  const smoke = await smokeValidateCandidates(options);

  return {
    stage: options.stage,
    tableName: options.tableName,
    orgId: options.orgId,
    orgName: options.orgName,
    targetDossierName: options.targetDossierName,
    cabinetId: options.cabinetId,
    fiscalYear: options.year,
    journals: JOURNALS.map((journal) => journal.journalCode),
    accounts: ACCOUNTS.map((account) => account.accountId),
    thirdParties: THIRD_PARTIES.map((thirdParty) => thirdParty.thirdPartyId),
    entries: {
      created,
      skippedExisting,
    },
    counters,
    smoke,
  };
}

function assertManualLetteringSeedTarget(options: ManualLetteringSeedOptions): void {
  if (!options.stage.trim()) {
    throw new Error("STAGE is required for manual-lettering seed data.");
  }
  if (!options.tableName.trim()) {
    throw new Error("TABLE_NAME is required for manual-lettering seed data.");
  }

  assertSafeSeedTarget(options);

  const stage = options.stage.trim().toLowerCase();
  if (stage === "prod" || stage === "production") {
    throw new Error("Refusing to seed manual-lettering data in production.");
  }
}

async function verifySeedOrganization(
  options: ManualLetteringSeedOptions,
  counters: SeedCounters,
): Promise<void> {
  const existingOrg = await getRawItem({
    PK: KeyFactory.orgKey(options.orgId),
    SK: KeyFactory.organizationSK(),
  });

  if (!existingOrg) {
    throw new Error(
      `Target organization ${options.orgId} does not exist. Refusing to create a new organization from the manual-lettering seed.`,
    );
  }

  const organization = parseOrganizationMetadata(existingOrg);
  if (organization.orgId !== options.orgId) {
    throw new Error(`Target organization metadata for ${options.orgId} is inconsistent.`);
  }
  if (organization.status !== "ACTIVE") {
    throw new Error(`Target organization ${options.orgId} is not active.`);
  }
  if (organization.workspaceType !== "COMPANY") {
    throw new Error(
      `Target organization ${options.orgId} is ${organization.workspaceType}; refusing to seed a cabinet organization.`,
    );
  }
  if (normalizeName(organization.name) !== normalizeName(options.orgName)) {
    throw new Error(
      `Target organization ${options.orgId} display name is "${organization.name}", expected "${options.orgName}".`,
    );
  }
  if (
    organization.accountingFramework !== options.accountingFramework ||
    organization.accountingFramework !== "SYSCOHADA_REVISED"
  ) {
    throw new Error(
      `Target organization ${options.orgId} uses accounting framework "${organization.accountingFramework}". Manual-lettering seed expects SYSCOHADA_REVISED.`,
    );
  }

  counters.skipped.organizations += 1;
}

async function ensureFiscalYear(
  options: ManualLetteringSeedOptions,
  counters: SeedCounters,
): Promise<void> {
  try {
    const fiscalYear = await LedgerService.getFiscalYear(options.orgId, options.year);
    if (
      fiscalYear.status !== "OPEN" ||
      fiscalYear.startDate !== `${options.year}-01-01` ||
      fiscalYear.endDate !== `${options.year}-12-31`
    ) {
      throw new Error(
        `Fiscal year ${options.year} exists but is not the expected open calendar year.`,
      );
    }
    counters.skipped.fiscalYears += 1;
  } catch (error) {
    if (!isNotFound(error)) {
      throw error;
    }
    await FiscalYearService.createFiscalYear(
      options.orgId,
      options.userId,
      {
        year: options.year,
        startDate: `${options.year}-01-01`,
        endDate: `${options.year}-12-31`,
      },
      "SYSCOHADA_REVISED",
    );
    counters.fiscalYearsCreated += 1;
  }
}

async function ensureJournals(
  options: ManualLetteringSeedOptions,
  counters: SeedCounters,
): Promise<void> {
  const journals = await JournalService.listJournals(options.orgId);
  const existingCodes = new Set(
    journals.map((journal) => journal.journalCode.toUpperCase()),
  );

  for (const journal of JOURNALS) {
    if (existingCodes.has(journal.journalCode)) {
      counters.skipped.journals += 1;
      continue;
    }
    await JournalService.createJournal(options.orgId, options.userId, {
      year: options.year,
      ...journal,
    });
    counters.journalsCreated += 1;
  }
}

async function ensureAccounts(
  options: ManualLetteringSeedOptions,
  counters: SeedCounters,
): Promise<void> {
  const accounts = await listAllAccounts(options.orgId);
  const accountsById = new Map(accounts.map((account) => [account.accountId, account]));

  for (const definition of ACCOUNTS) {
    const existing = accountsById.get(definition.accountId);
    if (existing) {
      if (
        existing.isActive === false ||
        existing.requiresThirdParty !== definition.requiresThirdParty ||
        existing.auxiliaryType !== definition.auxiliaryType
      ) {
        throw new Error(
          `Existing account ${definition.accountId} has incompatible auxiliary metadata.`,
        );
      }
      counters.skipped.accounts += 1;
      continue;
    }

    const now = new Date().toISOString();
    const account: Account = AccountSchema.parse({
      ...definition,
      orgId: options.orgId,
      entityType: "ACCOUNT",
      PK: KeyFactory.orgKey(options.orgId),
      SK: KeyFactory.accountSK(definition.accountId),
      createdAt: now,
      updatedAt: now,
    });
    await LedgerService.createAccount(account);
    counters.accountsCreated += 1;
  }
}

async function ensureThirdParties(
  options: ManualLetteringSeedOptions,
  counters: SeedCounters,
): Promise<void> {
  for (const definition of THIRD_PARTIES) {
    const existing = await getRawItem({
      PK: KeyFactory.orgKey(options.orgId),
      SK: KeyFactory.thirdPartySK(definition.type, definition.thirdPartyId),
    });

    if (existing) {
      if (
        existing.entityType !== "THIRD_PARTY" ||
        existing.orgId !== options.orgId ||
        existing.thirdPartyId !== definition.thirdPartyId ||
        existing.type !== definition.type ||
        existing.code !== definition.code
      ) {
        throw new Error(
          `Existing third party ${definition.thirdPartyId} is incompatible.`,
        );
      }
      if (existing.status !== "ACTIVE") {
        await ThirdPartyService.activate(
          options.orgId,
          definition.type,
          definition.thirdPartyId,
        );
      }
      counters.skipped.thirdParties += 1;
      continue;
    }

    const now = new Date().toISOString();
    const masterItem = {
      ...definition,
      status: "ACTIVE",
      orgId: options.orgId,
      entityType: "THIRD_PARTY",
      PK: KeyFactory.orgKey(options.orgId),
      SK: KeyFactory.thirdPartySK(definition.type, definition.thirdPartyId),
      createdAt: now,
      updatedAt: now,
    };
    const uniquenessItem = {
      PK: KeyFactory.orgKey(options.orgId),
      SK: KeyFactory.thirdPartyCodeSK(definition.code),
      entityType: "THIRD_PARTY_CODE_UNIQUE",
      thirdPartyId: definition.thirdPartyId,
      thirdPartyType: definition.type,
      createdAt: now,
    };

    try {
      await dynamoClient.send(
        new TransactWriteItemsCommand({
          TransactItems: [putIfAbsent(masterItem), putIfAbsent(uniquenessItem)],
        }),
      );
      counters.thirdPartiesCreated += 1;
    } catch (error: any) {
      if (error?.name !== "TransactionCanceledException") {
        throw error;
      }
      const codeLock = await getRawItem({
        PK: KeyFactory.orgKey(options.orgId),
        SK: KeyFactory.thirdPartyCodeSK(definition.code),
      });
      if (
        codeLock?.thirdPartyId === definition.thirdPartyId &&
        codeLock?.thirdPartyType === definition.type
      ) {
        counters.skipped.thirdParties += 1;
        continue;
      }
      throw new Error(
        `Third-party code ${definition.code} already exists for another third party.`,
      );
    }
  }
}

function manualLetteringEntries(year: number): SeedEntry[] {
  const customerLine = (debit: number, credit: number, label: string) => ({
    accountId: "41110000",
    thirdPartyId: "tp-cust-alpha",
    thirdPartyType: "CUSTOMER" as ThirdPartyTypeValue,
    debit,
    credit,
    label,
  });
  const supplierLine = (debit: number, credit: number, label: string) => ({
    accountId: "40110000",
    thirdPartyId: "tp-sup-beta",
    thirdPartyType: "SUPPLIER" as ThirdPartyTypeValue,
    debit,
    credit,
    label,
  });
  const bankLine = (debit: number, credit: number, label: string) => ({
    accountId: "52110000",
    debit,
    credit,
    label,
  });
  const salesLine = (debit: number, credit: number, label: string) => ({
    accountId: "70110000",
    debit,
    credit,
    label,
  });
  const purchaseLine = (debit: number, credit: number, label: string) => ({
    accountId: "60110000",
    debit,
    credit,
    label,
  });
  const entry = (
    entryId: string,
    date: string,
    journalCode: string,
    voucherNumber: string,
    label: string,
    lines: CreateEntryRequest["lines"],
  ): SeedEntry => ({
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
  });

  return [
    entry(
      "SEED-LTR-CUST-FULL-INVOICE-2026",
      "2026-01-10",
      "VT",
      "FAC-CUST-001",
      "Facture Client Alpha 001",
      [
        customerLine(100000, 0, "Client Alpha - facture FAC-CUST-001"),
        salesLine(0, 100000, "Ventes de marchandises"),
      ],
    ),
    entry(
      "SEED-LTR-CUST-FULL-PAYMENT-2026",
      "2026-01-20",
      "BQ",
      "PAY-CUST-001",
      "Encaissement Client Alpha 001",
      [
        bankLine(100000, 0, "Banque - encaissement PAY-CUST-001"),
        customerLine(0, 100000, "Client Alpha - règlement PAY-CUST-001"),
      ],
    ),
    entry(
      "SEED-LTR-CUST-PARTIAL-INVOICE-2026",
      "2026-02-05",
      "VT",
      "FAC-CUST-002",
      "Facture Client Alpha 002",
      [
        customerLine(150000, 0, "Client Alpha - facture FAC-CUST-002"),
        salesLine(0, 150000, "Ventes de marchandises"),
      ],
    ),
    entry(
      "SEED-LTR-CUST-PARTIAL-PAYMENT-2026",
      "2026-02-15",
      "BQ",
      "PAY-CUST-002",
      "Encaissement partiel Client Alpha 002",
      [
        bankLine(50000, 0, "Banque - encaissement PAY-CUST-002"),
        customerLine(0, 50000, "Client Alpha - règlement partiel PAY-CUST-002"),
      ],
    ),
    entry(
      "SEED-LTR-SUP-FULL-INVOICE-2026",
      "2026-03-01",
      "AC",
      "INV-SUP-001",
      "Facture Fournisseur Beta 001",
      [
        purchaseLine(80000, 0, "Achats de marchandises"),
        supplierLine(0, 80000, "Fournisseur Beta - facture INV-SUP-001"),
      ],
    ),
    entry(
      "SEED-LTR-SUP-FULL-PAYMENT-2026",
      "2026-03-12",
      "BQ",
      "PAY-SUP-001",
      "Règlement Fournisseur Beta 001",
      [
        supplierLine(80000, 0, "Fournisseur Beta - règlement PAY-SUP-001"),
        bankLine(0, 80000, "Banque - règlement PAY-SUP-001"),
      ],
    ),
    entry(
      "SEED-LTR-CUST-MISMATCH-INVOICE-2026",
      "2026-04-05",
      "VT",
      "FAC-CUST-003",
      "Facture Client Alpha déséquilibre test",
      [
        customerLine(70000, 0, "Client Alpha - facture FAC-CUST-003"),
        salesLine(0, 70000, "Ventes de marchandises"),
      ],
    ),
    entry(
      "SEED-LTR-CUST-MISMATCH-PAYMENT-2026",
      "2026-04-15",
      "BQ",
      "PAY-CUST-003",
      "Encaissement Client Alpha déséquilibre test",
      [
        bankLine(30000, 0, "Banque - encaissement PAY-CUST-003"),
        customerLine(0, 30000, "Client Alpha - règlement PAY-CUST-003"),
      ],
    ),
  ];
}

async function smokeValidateCandidates(
  options: ManualLetteringSeedOptions,
): Promise<CandidateSmoke> {
  const [customer, supplier] = await Promise.all([
    LetteringService.listCandidates(options.orgId, {
      fiscalYear: options.year,
      accountId: "41110000",
      thirdPartyId: "tp-cust-alpha",
      thirdPartyType: "CUSTOMER",
      limit: 100,
    }),
    LetteringService.listCandidates(options.orgId, {
      fiscalYear: options.year,
      accountId: "40110000",
      thirdPartyId: "tp-sup-beta",
      thirdPartyType: "SUPPLIER",
      limit: 100,
    }),
  ]);
  const dtoTechnicalFieldsFound = technicalFields(customer).concat(
    technicalFields(supplier),
  );
  const expectedCases = {
    customerFullMatchReady:
      hasCandidateLine(customer.lines, "FAC-CUST-001", 100000, 0) &&
      hasCandidateLine(customer.lines, "PAY-CUST-001", 0, 100000),
    customerPartialMatchReady:
      hasCandidateLine(customer.lines, "FAC-CUST-002", 150000, 0) &&
      hasCandidateLine(customer.lines, "PAY-CUST-002", 0, 50000),
    supplierFullMatchReady:
      hasCandidateLine(supplier.lines, "INV-SUP-001", 0, 80000) &&
      hasCandidateLine(supplier.lines, "PAY-SUP-001", 80000, 0),
    mismatchProtectionLinesReady:
      hasCandidateLine(customer.lines, "FAC-CUST-003", 70000, 0) &&
      hasCandidateLine(customer.lines, "PAY-CUST-003", 0, 30000),
  };

  return {
    customerCandidateCount: customer.lines.length,
    supplierCandidateCount: supplier.lines.length,
    customerReferences: sortedReferences(customer.lines),
    supplierReferences: sortedReferences(supplier.lines),
    expectedCases,
    dtoTechnicalFieldsFound,
  };
}

async function listEntriesByReference(orgId: string, year: number) {
  const entries = await listAllEntries(orgId, year);
  return new Map(
    entries
      .filter((entry) => entry.voucherNumber)
      .map((entry) => [entry.voucherNumber as string, entry]),
  );
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

async function listAllAccounts(orgId: string) {
  const accounts = [];
  let cursor: string | undefined;
  do {
    const result = await LedgerService.listAccounts(orgId, {
      cursor,
      limit: 200,
    });
    accounts.push(...result.accounts);
    cursor = result.nextCursor;
  } while (cursor);
  return accounts;
}

async function findEntry(options: ManualLetteringSeedOptions, entryId: string) {
  try {
    return await LedgerService.getEntryDetail(options.orgId, options.year, entryId);
  } catch (error) {
    if (isNotFound(error)) {
      return null;
    }
    throw error;
  }
}

async function getRawItem(key: { PK: string; SK: string }) {
  const result = await dynamoClient.send(
    new GetItemCommand({
      TableName: config.TABLE_NAME,
      Key: marshall(key),
    }),
  );
  return result.Item ? unmarshall(result.Item) : null;
}

function putIfAbsent(item: Record<string, unknown>): TransactWriteItem {
  return {
    Put: {
      TableName: config.TABLE_NAME,
      Item: marshall(item, { removeUndefinedValues: true }),
      ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
    },
  };
}

function emptyCounters(): SeedCounters {
  return {
    organizationsCreated: 0,
    organizationAccessCreated: 0,
    fiscalYearsCreated: 0,
    journalsCreated: 0,
    accountsCreated: 0,
    thirdPartiesCreated: 0,
    entriesCreated: 0,
    skipped: {
      organizations: 0,
      organizationAccess: 0,
      fiscalYears: 0,
      journals: 0,
      accounts: 0,
      thirdParties: 0,
      entries: 0,
    },
  };
}

function isNotFound(error: unknown): boolean {
  return (
    error instanceof AppError &&
    ["ERROR_ENTRY_NOT_FOUND", "ERROR_FISCAL_YEAR_NOT_FOUND"].includes(
      error.messageCode,
    )
  );
}

function technicalFields(value: unknown): string[] {
  const found = new Set<string>();
  const visit = (candidate: unknown) => {
    if (!candidate || typeof candidate !== "object") {
      return;
    }
    for (const [key, nested] of Object.entries(candidate)) {
      if (key === "PK" || key === "SK" || key === "entityType" || /^GSI\d/.test(key)) {
        found.add(key);
      }
      visit(nested);
    }
  };

  visit(value);
  return [...found].sort();
}

function sortedReferences(lines: Array<{ reference?: string }>): string[] {
  return lines
    .map((line) => line.reference)
    .filter((reference): reference is string => !!reference)
    .sort((left, right) => left.localeCompare(right));
}

function hasCandidateLine(
  lines: Array<{ reference?: string; debit: number; credit: number; remainingAmount: number }>,
  reference: string,
  debit: number,
  credit: number,
): boolean {
  const originalAmount = debit > 0 ? debit : credit;
  return lines.some(
    (line) =>
      line.reference === reference &&
      line.debit === debit &&
      line.credit === credit &&
      line.remainingAmount === originalAmount,
  );
}

interface RawSeedOptions {
  stage: string;
  tableName: string;
  targetOrgId?: string;
  targetDossierName?: string;
  targetCabinetId?: string;
  year: number;
  isLocal: boolean;
  writeConfirmed: boolean;
  userId: string;
}

function readRawOptions(): RawSeedOptions {
  const stage = process.env.STAGE?.trim() ?? "";
  const tableName = process.env.TABLE_NAME?.trim() ?? "";
  const targetOrgId = process.env.TARGET_ORG_ID?.trim();
  const targetDossierName = process.env.TARGET_DOSSIER_NAME?.trim();
  const targetCabinetId = process.env.TARGET_CABINET_ID?.trim();

  if (!stage || !tableName) {
    throw new Error(
      'STAGE and TABLE_NAME are required. Example: STAGE=dev TABLE_NAME=liass-ohada-dev-accounting-table TARGET_DOSSIER_NAME="DONA SHOP" npm run seed:manual-lettering-test-data -w @liass-ohada/backend',
    );
  }
  if (!targetOrgId && !targetDossierName) {
    throw new Error(
      'TARGET_ORG_ID or TARGET_DOSSIER_NAME is required. Preferred example: STAGE=dev TABLE_NAME=liass-ohada-dev-accounting-table TARGET_DOSSIER_NAME="DONA SHOP" npm run seed:manual-lettering-test-data -w @liass-ohada/backend',
    );
  }

  return {
    targetOrgId,
    targetDossierName,
    targetCabinetId,
    year: Number(process.env.FISCAL_YEAR ?? DEFAULT_FISCAL_YEAR),
    stage,
    tableName,
    isLocal: !!process.env.LOCALSTACK_URL,
    writeConfirmed: process.env.SEED_CONFIRM_WRITE === "yes",
    userId: process.env.SEED_USER_ID ?? DEFAULT_USER_ID,
  };
}

async function readOptions(): Promise<ManualLetteringSeedOptions> {
  const raw = readRawOptions();
  assertManualLetteringRawTarget(raw);

  if (raw.targetOrgId) {
    const organization = await loadExistingOrganization(raw.targetOrgId);
    if (
      raw.targetDossierName &&
      normalizeName(organization.name) !== normalizeName(raw.targetDossierName)
    ) {
      throw new Error(
        `TARGET_ORG_ID ${raw.targetOrgId} resolved to "${organization.name}", not "${raw.targetDossierName}".`,
      );
    }
    if (raw.targetCabinetId) {
      await verifyCabinetClientDossierLink(raw.targetCabinetId, organization.orgId);
    }
    return optionsFromOrganization(raw, organization, raw.targetCabinetId);
  }

  const resolved = await resolveExistingDossierByName(raw);
  return optionsFromOrganization(raw, resolved.organization, resolved.cabinetId);
}

function assertManualLetteringRawTarget(options: RawSeedOptions): void {
  assertSafeSeedTarget(options);

  const stage = options.stage.trim().toLowerCase();
  if (stage === "prod" || stage === "production") {
    throw new Error("Refusing to seed manual-lettering data in production.");
  }

  if (!Number.isInteger(options.year) || options.year < 2000 || options.year > 2100) {
    throw new Error(`Invalid FISCAL_YEAR "${options.year}".`);
  }
}

function optionsFromOrganization(
  raw: RawSeedOptions,
  organization: Organization,
  cabinetId?: string,
): ManualLetteringSeedOptions {
  if (organization.workspaceType !== "COMPANY") {
    throw new Error(
      `Target organization ${organization.orgId} is ${organization.workspaceType}; refusing to seed the cabinet organization itself.`,
    );
  }
  if (organization.status !== "ACTIVE") {
    throw new Error(`Target organization ${organization.orgId} is not active.`);
  }
  if (organization.accountingFramework !== "SYSCOHADA_REVISED") {
    throw new Error(
      `Target organization ${organization.orgId} uses "${organization.accountingFramework}". Manual-lettering seed expects SYSCOHADA_REVISED.`,
    );
  }

  return {
    orgId: organization.orgId,
    orgName: organization.name,
    targetDossierName: raw.targetDossierName,
    cabinetId,
    accountingFramework: organization.accountingFramework,
    year: raw.year,
    stage: raw.stage,
    tableName: raw.tableName,
    isLocal: raw.isLocal,
    writeConfirmed: raw.writeConfirmed,
    userId: raw.userId,
  };
}

async function resolveExistingDossierByName(raw: RawSeedOptions): Promise<{
  organization: Organization;
  cabinetId: string;
}> {
  const targetName = raw.targetDossierName;
  if (!targetName) {
    throw new Error("TARGET_DOSSIER_NAME is required when TARGET_ORG_ID is absent.");
  }

  const cabinetIds = raw.targetCabinetId
    ? [raw.targetCabinetId]
    : await findCabinetIdsForSeedUser(raw.userId);
  if (cabinetIds.length === 0) {
    throw new Error(
      `Cannot resolve dossier "${targetName}" without TARGET_CABINET_ID or an active accounting-firm workspace for SEED_USER_ID "${raw.userId}".`,
    );
  }

  const matches: Array<{ cabinetId: string; orgId: string; displayName: string }> = [];
  for (const cabinetId of cabinetIds) {
    const dossiers = await CabinetDossierRepository.listClientDossiers({
      cabinetId,
      cabinetOrgId: "",
    });
    for (const dossier of dossiers) {
      if (normalizeName(dossier.displayName) === normalizeName(targetName)) {
        matches.push({ cabinetId, orgId: dossier.orgId, displayName: dossier.displayName });
      }
    }
  }

  if (matches.length === 0) {
    throw new Error(
      `No active client dossier named "${targetName}" was found for cabinet(s): ${cabinetIds.join(", ")}.`,
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `Multiple active client dossiers named "${targetName}" were found: ${matches
        .map((match) => `${match.displayName}/${match.orgId}@${match.cabinetId}`)
        .join(", ")}.`,
    );
  }

  const match = matches[0];
  await verifyCabinetClientDossierLink(match.cabinetId, match.orgId);
  const organization = await loadExistingOrganization(match.orgId);
  if (normalizeName(organization.name) !== normalizeName(targetName)) {
    throw new Error(
      `Cabinet dossier "${targetName}" resolved to org ${match.orgId}, but organization metadata name is "${organization.name}".`,
    );
  }

  return { organization, cabinetId: match.cabinetId };
}

async function findCabinetIdsForSeedUser(userId: string): Promise<string[]> {
  const workspaces = await OnboardingRepository.listActiveUserWorkspaces(userId);
  return [
    ...new Set(
      workspaces
        .filter((workspace) => workspace.workspaceType === "ACCOUNTING_FIRM")
        .map((workspace) => workspace.cabinetId)
        .filter((cabinetId): cabinetId is string => Boolean(cabinetId)),
    ),
  ].sort((left, right) => left.localeCompare(right));
}

async function verifyCabinetClientDossierLink(
  cabinetId: string,
  orgId: string,
): Promise<void> {
  const item = await getRawItem({
    PK: KeyFactory.cabinetPK(cabinetId),
    SK: KeyFactory.cabinetDossierSK(orgId),
  });
  if (!item) {
    throw new Error(
      `Organization ${orgId} is not linked as a dossier under cabinet ${cabinetId}.`,
    );
  }
  if (
    item.entityType !== "CABINET_DOSSIER" ||
    item.cabinetId !== cabinetId ||
    item.orgId !== orgId ||
    item.relationship !== "CLIENT" ||
    item.status !== "ACTIVE"
  ) {
    throw new Error(
      `Organization ${orgId} is not an active client dossier under cabinet ${cabinetId}.`,
    );
  }
}

async function loadExistingOrganization(orgId: string): Promise<Organization> {
  const item = await getRawItem({
    PK: KeyFactory.orgKey(orgId),
    SK: KeyFactory.organizationSK(),
  });
  if (!item) {
    throw new Error(`Organization ${orgId} does not exist.`);
  }
  return parseOrganizationMetadata(item);
}

function parseOrganizationMetadata(item: Record<string, unknown>): Organization {
  if (item.entityType !== "ORGANIZATION") {
    throw new Error("Target organization metadata item is not an ORGANIZATION.");
  }
  return OrganizationSchema.parse({
    orgId: item.orgId,
    name: item.name,
    country: item.country,
    accountingFramework: item.accountingFramework,
    workspaceType: item.workspaceType,
    status: item.status,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  });
}

function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleUpperCase("fr-FR");
}

async function main(): Promise<void> {
  const options = await readOptions();
  console.log(
    JSON.stringify(
      {
        warning: "NON-PRODUCTION MANUAL LETTERING SEED DATA WRITE",
        stage: options.stage,
        tableName: options.tableName,
        targetDossierName: options.targetDossierName,
        cabinetId: options.cabinetId,
        orgId: options.orgId,
        orgName: options.orgName,
        fiscalYear: options.year,
        userId: options.userId,
        local: options.isLocal,
      },
      null,
      2,
    ),
  );

  const result = await seedManualLetteringTestData(options);
  console.log(JSON.stringify(result, null, 2));

  if (result.smoke.dtoTechnicalFieldsFound.length > 0) {
    throw new Error(
      `Manual-lettering smoke DTO exposed technical fields: ${result.smoke.dtoTechnicalFieldsFound.join(", ")}`,
    );
  }
  const missingCases = Object.entries(result.smoke.expectedCases)
    .filter(([, ready]) => !ready)
    .map(([caseName]) => caseName);
  if (missingCases.length > 0) {
    throw new Error(
      `Manual-lettering smoke did not find expected candidate case(s): ${missingCases.join(", ")}.`,
    );
  }

  console.log(
    [
      "",
      "Manual lettering test values",
      `Dossier: ${result.orgName}`,
      `Resolved orgId: ${result.orgId}`,
      `Fiscal year: ${result.fiscalYear}`,
      "",
      "Customer test:",
      "Account: 41110000",
      "Third party: Client Alpha",
      "Third party code: CUST-ALPHA",
      "Third party id: tp-cust-alpha",
      "Type: CUSTOMER",
      "",
      "Supplier test:",
      "Account: 40110000",
      "Third party: Fournisseur Beta",
      "Third party code: SUP-BETA",
      "Third party id: tp-sup-beta",
      "Type: SUPPLIER",
    ].join("\n"),
  );
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
