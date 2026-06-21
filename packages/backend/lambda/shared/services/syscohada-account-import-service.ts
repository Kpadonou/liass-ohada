import { KeyFactory } from "@/lambda/shared/key-builder";
import { AppError } from "@/lambda/shared/app-error";
import { LedgerService } from "@/lambda/shared/services/ledger-service";
import {
  AccountSchema,
  padAccountId,
  type Account,
} from "@liass-ohada/shared/accounting";
import { defaultAuxiliaryMetadata } from "../account-auxiliary";

export interface SyscohadaReferenceAccount {
  accountNumber: string;
  label: string;
  classCode: number;
}

export interface SyscohadaImportResult {
  created: number;
  skippedExisting: number;
  skippedUnsupported: number;
  totalParsed: number;
}

interface ImportSyscohadaAccountsOptions {
  concurrency?: number;
  maxAttempts?: number;
  now?: string;
}

const ACCOUNT_TOKEN = /(^|\s)([1-9]\d{1,3})\.?\s+([\s\S]*?)(?=\s+[1-9]\d{1,3}\.?\s+|$)/g;
const PAGE_HEADING = /^### Page \d+$/gm;

export class SyscohadaAccountImportService {
  static parseReference(markdown: string): SyscohadaReferenceAccount[] {
    const text = SyscohadaAccountImportService.referenceText(markdown);
    const seen = new Set<string>();
    const accounts: SyscohadaReferenceAccount[] = [];

    for (const match of text.matchAll(ACCOUNT_TOKEN)) {
      const accountNumber = match[2];
      const classCode = Number(accountNumber.charAt(0));
      const label = normalizeLabel(match[3] ?? "");

      if (
        classCode < 1 ||
        classCode > 8 ||
        seen.has(accountNumber) ||
        !isUsableLabel(label)
      ) {
        continue;
      }

      seen.add(accountNumber);
      accounts.push({
        accountNumber,
        label,
        classCode,
      });
    }

    return accounts.sort((a, b) => a.accountNumber.localeCompare(b.accountNumber));
  }

  static async importAccounts(
    orgId: string,
    referenceAccounts: readonly SyscohadaReferenceAccount[],
    options: ImportSyscohadaAccountsOptions = {},
  ): Promise<SyscohadaImportResult> {
    const now = options.now ?? new Date().toISOString();
    const concurrency = Math.max(1, Math.min(options.concurrency ?? 5, 20));
    const maxAttempts = Math.max(1, Math.min(options.maxAttempts ?? 4, 8));
    const existingAccountIds = await listExistingAccountIds(orgId);
    let created = 0;
    let skippedExisting = 0;
    let skippedUnsupported = 0;
    let nextIndex = 0;

    const importOne = async (referenceAccount: SyscohadaReferenceAccount) => {
      const account = SyscohadaAccountImportService.toAccount(
        orgId,
        referenceAccount,
        now,
      );

      if (!account) {
        skippedUnsupported += 1;
        return;
      }

      if (existingAccountIds.has(account.accountId)) {
        skippedExisting += 1;
        return;
      }

      try {
        await createAccountWithRetry(account, maxAttempts);
        created += 1;
        existingAccountIds.add(account.accountId);
      } catch (error) {
        if (
          error instanceof AppError &&
          error.messageCode === "ERROR_ACCOUNT_ALREADY_EXISTS"
        ) {
          skippedExisting += 1;
          existingAccountIds.add(account.accountId);
          return;
        }

        throw error;
      }
    };

    const workers = Array.from(
      { length: Math.min(concurrency, referenceAccounts.length) },
      async () => {
        while (nextIndex < referenceAccounts.length) {
          const referenceAccount = referenceAccounts[nextIndex++];
          await importOne(referenceAccount);
        }
      },
    );

    await Promise.all(workers);

    return {
      created,
      skippedExisting,
      skippedUnsupported,
      totalParsed: referenceAccounts.length,
    };
  }

  static toAccount(
    orgId: string,
    referenceAccount: SyscohadaReferenceAccount,
    now: string,
  ): Account | null {
    if (referenceAccount.classCode < 1 || referenceAccount.classCode > 8) {
      return null;
    }

    const accountId = padAccountId(referenceAccount.accountNumber);
    const accountNature: Account["accountNature"] =
      referenceAccount.classCode <= 5 ? "BALANCE" : "INCOME";
    const accountUsage: Account["accountUsage"] = "BOTH";
    const isThirdPartyAccount = referenceAccount.classCode === 4;
    const auxiliaryMetadata = defaultAuxiliaryMetadata(
      accountId,
      isThirdPartyAccount,
    );

    return AccountSchema.parse({
      orgId,
      accountId,
      accountName: referenceAccount.label,
      accountNature,
      accountUsage,
      isThirdPartyAccount,
      ...auxiliaryMetadata,
      classCode: referenceAccount.classCode,
      financialStatementCode: `SYSCOHADA_CLASS_${referenceAccount.classCode}`,
      allowReconciliation: isThirdPartyAccount,
      entityType: "ACCOUNT",
      PK: KeyFactory.orgKey(orgId),
      SK: KeyFactory.accountSK(accountId),
      createdAt: now,
      updatedAt: now,
    });
  }

  private static referenceText(markdown: string): string {
    const marker = "## Texte extrait";
    const start = markdown.indexOf(marker);
    const source = start >= 0 ? markdown.slice(start + marker.length) : markdown;
    const supportedClasses = source.replace(/\bCLASSE 9\b[\s\S]*$/i, " ");

    return supportedClasses
      .replace(/(\d{2,4})\.\./g, "$1 ")
      .replace(PAGE_HEADING, " ")
      .replace(/^---$/gm, " ")
      .replace(/\r/g, "\n")
      .replace(/[ \t]+/g, " ")
      .replace(/\n+/g, " ")
      .trim();
  }
}

function normalizeLabel(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/\s+\./g, ".")
    .trim()
    .replace(/\.$/, "")
    .trim();
}

function isUsableLabel(label: string): boolean {
  return (
    label.length >= 3 &&
    /[A-Za-zÀ-ÖØ-öø-ÿ]/.test(label) &&
    !/^à\b/i.test(label) &&
    !/^classe\b/i.test(label) &&
    !/^page\b/i.test(label)
  );
}

async function createAccountWithRetry(
  account: Account,
  maxAttempts: number,
): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await LedgerService.createAccount(account);
      return;
    } catch (error) {
      if (error instanceof AppError || !isTransientAwsError(error) || attempt === maxAttempts) {
        throw error;
      }

      await sleep(250 * attempt);
    }
  }
}

function isTransientAwsError(error: unknown): boolean {
  const candidate = error as { code?: string; name?: string } | undefined;
  const code = candidate?.code ?? candidate?.name;

  return Boolean(
    code &&
      [
        "ETIMEDOUT",
        "ECONNRESET",
        "TimeoutError",
        "NetworkingError",
        "RequestTimeout",
        "ThrottlingException",
        "ProvisionedThroughputExceededException",
      ].includes(code),
  );
}

function sleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

async function listExistingAccountIds(orgId: string): Promise<Set<string>> {
  const existingAccountIds = new Set<string>();
  let cursor: string | undefined;

  do {
    const result = await LedgerService.listAccounts(orgId, {
      cursor,
      limit: 1000,
    });

    for (const account of result.accounts) {
      existingAccountIds.add(account.accountId);
    }

    cursor = result.nextCursor;
  } while (cursor);

  return existingAccountIds;
}
