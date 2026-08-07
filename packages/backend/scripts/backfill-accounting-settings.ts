import { readFileSync } from "node:fs";
import {
  AccountingSettingsBackfillResult,
  AccountingSettingsService,
} from "../lambda/domains/accounting/settings/accounting-settings-service";

export interface AccountingSettingsBackfillOptions {
  apply: boolean;
  orgIds: string[];
}

const readOrgIdsFile = (filePath: string): string[] => {
  const contents = readFileSync(filePath, "utf8").trim();
  if (!contents) {
    return [];
  }

  if (contents.startsWith("[")) {
    const parsed = JSON.parse(contents) as unknown;
    if (
      !Array.isArray(parsed) ||
      parsed.some((value) => typeof value !== "string")
    ) {
      throw new Error(
        "--org-ids-file JSON must be an array of organization IDs.",
      );
    }
    return parsed;
  }

  return contents
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean);
};

export const parseAccountingSettingsBackfillArgs = (
  args: string[],
): AccountingSettingsBackfillOptions => {
  const orgIds: string[] = [];
  let apply = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--apply") {
      apply = true;
      continue;
    }
    if (argument === "--org-id") {
      const orgId = args[index + 1];
      if (!orgId || orgId.startsWith("--")) {
        throw new Error("--org-id requires a value.");
      }
      orgIds.push(orgId);
      index += 1;
      continue;
    }
    if (argument === "--org-ids-file") {
      const filePath = args[index + 1];
      if (!filePath || filePath.startsWith("--")) {
        throw new Error("--org-ids-file requires a path.");
      }
      orgIds.push(...readOrgIdsFile(filePath));
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }

  const uniqueOrgIds = Array.from(
    new Set(orgIds.map((orgId) => orgId.trim()).filter(Boolean)),
  );
  if (uniqueOrgIds.length === 0) {
    throw new Error("Provide at least one --org-id or --org-ids-file.");
  }

  return { apply, orgIds: uniqueOrgIds };
};

const reportResult = (result: AccountingSettingsBackfillResult): void => {
  const details = {
    accountingSettingsFramework: result.accountingSettingsFramework,
    legacyFramework: result.legacyFramework,
    orgId: result.orgId,
    outcome: result.outcome,
  };
  if (
    result.outcome === "MISMATCH" ||
    result.outcome === "ORGANIZATION_NOT_FOUND" ||
    result.outcome === "LEGACY_FRAMEWORK_MISSING" ||
    result.outcome === "LEGACY_FRAMEWORK_INVALID"
  ) {
    console.warn("[ACCOUNTING_SETTINGS_BACKFILL]", details);
    return;
  }
  console.info("[ACCOUNTING_SETTINGS_BACKFILL]", details);
};

export const runAccountingSettingsBackfill = async (
  options: AccountingSettingsBackfillOptions,
): Promise<AccountingSettingsBackfillResult[]> => {
  const results: AccountingSettingsBackfillResult[] = [];
  for (const orgId of options.orgIds) {
    const result = await AccountingSettingsService.backfillOrganization({
      apply: options.apply,
      orgId,
    });
    reportResult(result);
    results.push(result);
  }
  return results;
};

if (require.main === module) {
  runAccountingSettingsBackfill(
    parseAccountingSettingsBackfillArgs(process.argv.slice(2)),
  ).catch((error) => {
    console.error("AccountingSettings backfill failed.", error);
    process.exitCode = 1;
  });
}
