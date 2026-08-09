import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  cleanupLegacyProductAccessForOrganization,
  parseLegacyProductAccessCleanupArgs,
  runLegacyProductAccessCleanup,
} from "@/scripts/cleanup-legacy-product-access";
import {
  LegacyProductCode,
  PersistedProductCode,
  ProductAccessMigrationInspection,
  ProductAccessRepository,
} from "@/lambda/shared/repositories/product-access-repository";

const validInspection = (
  productCode: PersistedProductCode,
  status: "ACTIVE" | "INACTIVE" = "ACTIVE",
): ProductAccessMigrationInspection => ({
  access: {
    orgId: "org-123",
    productCode,
    status,
    createdAt: "2026-08-07T10:00:00.000Z",
    updatedAt: "2026-08-07T10:00:00.000Z",
  },
  expectedProductCode: productCode,
  state: "VALID",
});

const absentInspection = (
  productCode: PersistedProductCode,
): ProductAccessMigrationInspection => ({
  expectedProductCode: productCode,
  state: "ABSENT",
});

const mockInspections = (input: {
  accounting?: ProductAccessMigrationInspection;
  projects?: ProductAccessMigrationInspection;
  treasury?: ProductAccessMigrationInspection;
}) =>
  jest
    .spyOn(ProductAccessRepository, "inspectProductAccessForMigration")
    .mockImplementation(async (_orgId, productCode) => {
      if (productCode === "ACCOUNTING") {
        return input.accounting ?? validInspection("ACCOUNTING");
      }
      if (productCode === "PROJECTS") {
        return input.projects ?? absentInspection("PROJECTS");
      }
      return input.treasury ?? absentInspection("TREASURY");
    });

describe("legacy ProductAccess cleanup", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.spyOn(console, "info").mockImplementation(() => undefined);
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  test("dry-run plans both legacy deletions and performs zero writes", async () => {
    mockInspections({
      projects: validInspection("PROJECTS"),
      treasury: validInspection("TREASURY"),
    });
    const deleteLegacy = jest.spyOn(
      ProductAccessRepository,
      "deleteLegacyProductAccessForMigration",
    );

    const report = await cleanupLegacyProductAccessForOrganization(
      "org-123",
      false,
    );

    expect(report).toMatchObject({
      canonicalAccounting: "ACTIVE",
      plannedDeletions: ["PROJECTS", "TREASURY"],
      status: "READY_FOR_CLEANUP",
    });
    expect(deleteLegacy).not.toHaveBeenCalled();
  });

  test.each(["ACTIVE", "INACTIVE"] as const)(
    "allows conditional cleanup when canonical ACCOUNTING is %s",
    async (status) => {
      mockInspections({
        accounting: validInspection("ACCOUNTING", status),
        projects: validInspection("PROJECTS"),
        treasury: validInspection("TREASURY"),
      });
      const deleteLegacy = jest
        .spyOn(
          ProductAccessRepository,
          "deleteLegacyProductAccessForMigration",
        )
        .mockResolvedValue(undefined);

      const report = await cleanupLegacyProductAccessForOrganization(
        "org-123",
        true,
      );

      expect(report).toMatchObject({
        appliedDeletions: ["PROJECTS", "TREASURY"],
        canonicalAccounting: status,
        status: "CLEANED",
      });
      expect(deleteLegacy.mock.calls).toEqual([
        ["org-123", "PROJECTS"],
        ["org-123", "TREASURY"],
      ]);
    },
  );

  test("blocks apply when canonical ACCOUNTING is missing", async () => {
    mockInspections({
      accounting: absentInspection("ACCOUNTING"),
      projects: validInspection("PROJECTS"),
      treasury: validInspection("TREASURY"),
    });
    const deleteLegacy = jest.spyOn(
      ProductAccessRepository,
      "deleteLegacyProductAccessForMigration",
    );

    const report = await cleanupLegacyProductAccessForOrganization(
      "org-123",
      true,
    );

    expect(report.status).toBe("BLOCKED_MISSING_CANONICAL_ACCOUNTING");
    expect(report.plannedDeletions).toEqual([]);
    expect(deleteLegacy).not.toHaveBeenCalled();
  });

  test("reports mismatched legacy identity with safe diagnostics and does not delete", async () => {
    mockInspections({
      projects: {
        actualEntityType: "OTHER",
        actualOrgId: "org-123",
        actualProductCode: "TREASURY",
        expectedProductCode: "PROJECTS",
        state: "MISMATCH",
      },
    });
    const deleteLegacy = jest.spyOn(
      ProductAccessRepository,
      "deleteLegacyProductAccessForMigration",
    );

    const report = await cleanupLegacyProductAccessForOrganization(
      "org-123",
      true,
    );

    expect(report.status).toBe("LEGACY_ROW_MISMATCH");
    expect(report.mismatches).toEqual([
      {
        actualEntityType: "OTHER",
        actualOrgId: "org-123",
        actualProductCode: "TREASURY",
        expectedProductCode: "PROJECTS",
      },
    ]);
    expect(deleteLegacy).not.toHaveBeenCalled();
  });

  test.each([
    [["PROJECTS"], "READY_FOR_CLEANUP"],
    [["TREASURY"], "READY_FOR_CLEANUP"],
    [[], "CLEAN"],
  ] as Array<[LegacyProductCode[], string]>)(
    "handles partial legacy state %j idempotently",
    async (present, expectedStatus) => {
      mockInspections({
        projects: present.includes("PROJECTS")
          ? validInspection("PROJECTS")
          : absentInspection("PROJECTS"),
        treasury: present.includes("TREASURY")
          ? validInspection("TREASURY")
          : absentInspection("TREASURY"),
      });

      const report = await cleanupLegacyProductAccessForOrganization(
        "org-123",
        false,
      );

      expect(report.status).toBe(expectedStatus);
      expect(report.plannedDeletions).toEqual(present);
    },
  );

  test("reports a conditional deletion race and never retries", async () => {
    mockInspections({ projects: validInspection("PROJECTS") });
    const deleteLegacy = jest
      .spyOn(
        ProductAccessRepository,
        "deleteLegacyProductAccessForMigration",
      )
      .mockRejectedValue(new Error("ConditionalCheckFailedException"));

    const report = await cleanupLegacyProductAccessForOrganization(
      "org-123",
      true,
    );

    expect(report).toMatchObject({
      appliedDeletions: [],
      failedDeletion: "PROJECTS",
      status: "DELETE_FAILED",
    });
    expect(deleteLegacy).toHaveBeenCalledTimes(1);
  });

  test("summarizes operational results by organization and legacy code", async () => {
    mockInspections({ projects: validInspection("PROJECTS") });

    const result = await runLegacyProductAccessCleanup({
      apply: false,
      orgIds: ["org-123", "org-456"],
    });

    expect(result.summary).toEqual({
      blocked: 0,
      clean: 0,
      cleaned: 0,
      deletionsApplied: 0,
      deletionsPlanned: 2,
      failures: 0,
      legacyProjectsFound: 2,
      legacyTreasuryFound: 0,
      organizationsInspected: 2,
      ready: 2,
    });
  });
});

describe("legacy ProductAccess cleanup CLI", () => {
  let temporaryDirectory: string;

  afterEach(() => {
    if (temporaryDirectory) {
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
  });

  test("accepts repeated IDs, an ID file, deduplicates, and defaults to dry-run", () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), "liass-product-access-"));
    const filePath = join(temporaryDirectory, "org-ids.txt");
    writeFileSync(filePath, "org-2\norg-3\norg-2\n", "utf8");

    expect(
      parseLegacyProductAccessCleanupArgs([
        "--org-id",
        "org-1",
        "--org-id",
        "org-2",
        "--org-ids-file",
        filePath,
      ]),
    ).toEqual({ apply: false, orgIds: ["org-1", "org-2", "org-3"] });
  });

  test("requires explicit --apply for write mode", () => {
    expect(
      parseLegacyProductAccessCleanupArgs([
        "--org-id",
        "org-1",
        "--apply",
      ]),
    ).toEqual({ apply: true, orgIds: ["org-1"] });
  });

  test.each<[string[]]>([
    [[]],
    [["--org-id"]],
    [["--org-ids-file"]],
    [["--unknown"]],
  ])("rejects malformed or empty arguments: %j", (args) => {
    expect(() => parseLegacyProductAccessCleanupArgs(args)).toThrow();
  });
});
