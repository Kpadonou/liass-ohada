import { readFileSync } from "node:fs";
import {
  LEGACY_PRODUCT_CODES,
  LegacyProductCode,
  ProductAccessMigrationInspection,
  ProductAccessRepository,
} from "../lambda/shared/repositories/product-access-repository";

export interface LegacyProductAccessCleanupOptions {
  apply: boolean;
  orgIds: string[];
}

export type CanonicalAccountingState =
  | "ACTIVE"
  | "INACTIVE"
  | "MISSING"
  | "MISMATCH";

export type LegacyProductAccessCleanupStatus =
  | "CLEAN"
  | "READY_FOR_CLEANUP"
  | "BLOCKED_MISSING_CANONICAL_ACCOUNTING"
  | "BLOCKED_CANONICAL_ACCOUNTING_MISMATCH"
  | "LEGACY_ROW_MISMATCH"
  | "DELETE_FAILED"
  | "CLEANED";

export interface LegacyProductAccessCleanupReport {
  appliedDeletions: LegacyProductCode[];
  canonicalAccounting: CanonicalAccountingState;
  failedDeletion?: LegacyProductCode;
  legacy: Record<LegacyProductCode, ProductAccessMigrationInspection["state"]>;
  mismatches: Array<{
    actualEntityType?: string;
    actualOrgId?: string;
    actualProductCode?: string;
    expectedProductCode: "ACCOUNTING" | LegacyProductCode;
  }>;
  orgId: string;
  plannedDeletions: LegacyProductCode[];
  status: LegacyProductAccessCleanupStatus;
}

export interface LegacyProductAccessCleanupSummary {
  blocked: number;
  clean: number;
  cleaned: number;
  deletionsApplied: number;
  deletionsPlanned: number;
  failures: number;
  legacyProjectsFound: number;
  legacyTreasuryFound: number;
  organizationsInspected: number;
  ready: number;
}

export interface LegacyProductAccessCleanupRun {
  organizations: LegacyProductAccessCleanupReport[];
  summary: LegacyProductAccessCleanupSummary;
}

const readOrgIdsFile = (filePath: string): string[] => {
  const contents = readFileSync(filePath, "utf8").trim();
  if (!contents) return [];

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

export const parseLegacyProductAccessCleanupArgs = (
  args: string[],
): LegacyProductAccessCleanupOptions => {
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

const canonicalState = (
  inspection: ProductAccessMigrationInspection,
): CanonicalAccountingState => {
  if (inspection.state === "ABSENT") return "MISSING";
  if (inspection.state === "MISMATCH") return "MISMATCH";
  return inspection.access.status;
};

const legacyState = (
  inspections: readonly ProductAccessMigrationInspection[],
  productCode: LegacyProductCode,
) =>
  inspections.find(
    (inspection) => inspection.expectedProductCode === productCode,
  )?.state ?? "ABSENT";

export const cleanupLegacyProductAccessForOrganization = async (
  orgId: string,
  apply: boolean,
): Promise<LegacyProductAccessCleanupReport> => {
  const [accounting, ...legacyInspections] = await Promise.all([
    ProductAccessRepository.inspectProductAccessForMigration(
      orgId,
      "ACCOUNTING",
    ),
    ...LEGACY_PRODUCT_CODES.map((productCode) =>
      ProductAccessRepository.inspectProductAccessForMigration(
        orgId,
        productCode,
      ),
    ),
  ]);
  const canonicalAccounting = canonicalState(accounting);
  const legacy = {
    PROJECTS: legacyState(legacyInspections, "PROJECTS"),
    TREASURY: legacyState(legacyInspections, "TREASURY"),
  };
  const validLegacy = LEGACY_PRODUCT_CODES.filter(
    (productCode) => legacy[productCode] === "VALID",
  );
  const mismatches = [accounting, ...legacyInspections].flatMap((inspection) =>
    inspection.state === "MISMATCH"
      ? [
          {
            actualEntityType: inspection.actualEntityType,
            actualOrgId: inspection.actualOrgId,
            actualProductCode: inspection.actualProductCode,
            expectedProductCode: inspection.expectedProductCode,
          },
        ]
      : [],
  );
  const base = {
    appliedDeletions: [] as LegacyProductCode[],
    canonicalAccounting,
    legacy,
    mismatches,
    orgId,
    plannedDeletions: [] as LegacyProductCode[],
  };

  if (canonicalAccounting === "MISSING") {
    return {
      ...base,
      status: "BLOCKED_MISSING_CANONICAL_ACCOUNTING",
    };
  }
  if (canonicalAccounting === "MISMATCH") {
    return {
      ...base,
      status: "BLOCKED_CANONICAL_ACCOUNTING_MISMATCH",
    };
  }
  if (Object.values(legacy).includes("MISMATCH")) {
    return { ...base, status: "LEGACY_ROW_MISMATCH" };
  }
  if (validLegacy.length === 0) {
    return { ...base, status: "CLEAN" };
  }

  const plannedDeletions = [...validLegacy];
  if (!apply) {
    return {
      ...base,
      plannedDeletions,
      status: "READY_FOR_CLEANUP",
    };
  }

  const appliedDeletions: LegacyProductCode[] = [];
  for (const productCode of plannedDeletions) {
    try {
      await ProductAccessRepository.deleteLegacyProductAccessForMigration(
        orgId,
        productCode,
      );
      appliedDeletions.push(productCode);
    } catch {
      return {
        ...base,
        appliedDeletions,
        failedDeletion: productCode,
        plannedDeletions,
        status: "DELETE_FAILED",
      };
    }
  }

  return {
    ...base,
    appliedDeletions,
    plannedDeletions,
    status: "CLEANED",
  };
};

const summarize = (
  organizations: LegacyProductAccessCleanupReport[],
): LegacyProductAccessCleanupSummary => ({
  blocked: organizations.filter((report) => report.status.startsWith("BLOCKED"))
    .length,
  clean: organizations.filter((report) => report.status === "CLEAN").length,
  cleaned: organizations.filter((report) => report.status === "CLEANED").length,
  deletionsApplied: organizations.reduce(
    (count, report) => count + report.appliedDeletions.length,
    0,
  ),
  deletionsPlanned: organizations.reduce(
    (count, report) => count + report.plannedDeletions.length,
    0,
  ),
  failures: organizations.filter(
    (report) =>
      report.status === "DELETE_FAILED" ||
      report.status === "LEGACY_ROW_MISMATCH",
  ).length,
  legacyProjectsFound: organizations.filter(
    (report) => report.legacy.PROJECTS !== "ABSENT",
  ).length,
  legacyTreasuryFound: organizations.filter(
    (report) => report.legacy.TREASURY !== "ABSENT",
  ).length,
  organizationsInspected: organizations.length,
  ready: organizations.filter(
    (report) => report.status === "READY_FOR_CLEANUP",
  ).length,
});

const logOrganizationReport = (
  report: LegacyProductAccessCleanupReport,
  apply: boolean,
): void => {
  const details = {
    appliedDeletions: report.appliedDeletions,
    canonicalAccounting: report.canonicalAccounting,
    failedDeletion: report.failedDeletion,
    legacy: report.legacy,
    mismatches: report.mismatches,
    mode: apply ? "APPLY" : "DRY_RUN",
    orgId: report.orgId,
    plannedDeletions: report.plannedDeletions,
    status: report.status,
  };
  if (
    report.status.startsWith("BLOCKED") ||
    report.status === "LEGACY_ROW_MISMATCH" ||
    report.status === "DELETE_FAILED"
  ) {
    console.warn("[LEGACY_PRODUCT_ACCESS_CLEANUP]", details);
    return;
  }
  console.info("[LEGACY_PRODUCT_ACCESS_CLEANUP]", details);
};

export const runLegacyProductAccessCleanup = async (
  options: LegacyProductAccessCleanupOptions,
): Promise<LegacyProductAccessCleanupRun> => {
  const organizations: LegacyProductAccessCleanupReport[] = [];
  for (const orgId of options.orgIds) {
    const report = await cleanupLegacyProductAccessForOrganization(
      orgId,
      options.apply,
    );
    logOrganizationReport(report, options.apply);
    organizations.push(report);
  }
  const summary = summarize(organizations);
  console.info("[LEGACY_PRODUCT_ACCESS_CLEANUP_SUMMARY]", {
    ...summary,
    mode: options.apply ? "APPLY" : "DRY_RUN",
  });
  return { organizations, summary };
};

if (require.main === module) {
  runLegacyProductAccessCleanup(
    parseLegacyProductAccessCleanupArgs(process.argv.slice(2)),
  )
    .then(({ summary }) => {
      if (summary.blocked > 0 || summary.failures > 0) {
        process.exitCode = 1;
      }
    })
    .catch((error) => {
      console.error("Legacy ProductAccess cleanup failed.", error);
      process.exitCode = 1;
    });
}
