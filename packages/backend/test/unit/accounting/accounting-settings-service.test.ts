import { AccountingSettingsRepository } from "@/lambda/domains/accounting/settings/accounting-settings-repository";
import { AccountingSettingsService } from "@/lambda/domains/accounting/settings/accounting-settings-service";

const settings = (accountingFramework: "SYSCOHADA_REVISED" | "SYCEBNL") => ({
  orgId: "org-123",
  accountingFramework,
  createdAt: "2026-08-07T10:00:00.000Z",
  updatedAt: "2026-08-07T10:00:00.000Z",
});

describe("AccountingSettingsService", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.spyOn(console, "info").mockImplementation(() => undefined);
  });

  test("prefers AccountingSettings over a different legacy value", async () => {
    jest
      .spyOn(AccountingSettingsRepository, "getAccountingSettings")
      .mockResolvedValue(settings("SYCEBNL"));
    const legacyRead = jest.spyOn(
      AccountingSettingsRepository,
      "getLegacyOrganizationConfiguration",
    );

    await expect(
      AccountingSettingsService.resolveAccountingFramework(
        "org-123",
        "SYSCOHADA_REVISED",
      ),
    ).resolves.toBe("SYCEBNL");
    expect(legacyRead).not.toHaveBeenCalled();
  });

  test("falls back to the supplied legacy Organization projection", async () => {
    jest
      .spyOn(AccountingSettingsRepository, "getAccountingSettings")
      .mockResolvedValue(null);
    const legacyRead = jest.spyOn(
      AccountingSettingsRepository,
      "getLegacyOrganizationConfiguration",
    );

    await expect(
      AccountingSettingsService.resolveAccountingFramework(
        "org-123",
        "SYSCOHADA_REVISED",
      ),
    ).resolves.toBe("SYSCOHADA_REVISED");
    expect(legacyRead).not.toHaveBeenCalled();
  });

  test("reads the legacy Organization only when no projection was supplied", async () => {
    jest
      .spyOn(AccountingSettingsRepository, "getAccountingSettings")
      .mockResolvedValue(null);
    jest
      .spyOn(AccountingSettingsRepository, "getLegacyOrganizationConfiguration")
      .mockResolvedValue({
        accountingFramework: "SYCEBNL",
        organizationExists: true,
      });

    await expect(
      AccountingSettingsService.resolveAccountingFramework("org-123"),
    ).resolves.toBe("SYCEBNL");
  });

  test.each([undefined, "IFRS"])(
    "does not invent a framework when the legacy value is %s",
    async (legacyAccountingFramework) => {
      jest
        .spyOn(AccountingSettingsRepository, "getAccountingSettings")
        .mockResolvedValue(null);
      jest
        .spyOn(
          AccountingSettingsRepository,
          "getLegacyOrganizationConfiguration",
        )
        .mockResolvedValue({
          accountingFramework: legacyAccountingFramework,
          organizationExists: true,
        });

      await expect(
        AccountingSettingsService.resolveAccountingFramework("org-123"),
      ).rejects.toMatchObject({
        statusCode: 400,
        messageCode: "ERROR_INVALID_INPUT",
      });
    },
  );

  test("creates missing settings from the legacy Organization", async () => {
    jest
      .spyOn(AccountingSettingsRepository, "getAccountingSettings")
      .mockResolvedValue(null);
    jest
      .spyOn(AccountingSettingsRepository, "getLegacyOrganizationConfiguration")
      .mockResolvedValue({
        accountingFramework: "SYSCOHADA_REVISED",
        organizationExists: true,
      });
    const put = jest
      .spyOn(AccountingSettingsRepository, "putIfAbsent")
      .mockResolvedValue(true);

    await expect(
      AccountingSettingsService.backfillOrganization({
        apply: true,
        orgId: "org-123",
        timestamp: "2026-08-07T10:00:00.000Z",
      }),
    ).resolves.toMatchObject({ outcome: "CREATED" });
    expect(put).toHaveBeenCalledWith(
      expect.objectContaining({ accountingFramework: "SYSCOHADA_REVISED" }),
    );
  });

  test("dry-run reports a missing row without writing", async () => {
    jest
      .spyOn(AccountingSettingsRepository, "getAccountingSettings")
      .mockResolvedValue(null);
    jest
      .spyOn(AccountingSettingsRepository, "getLegacyOrganizationConfiguration")
      .mockResolvedValue({
        accountingFramework: "SYSCOHADA_REVISED",
        organizationExists: true,
      });
    const put = jest.spyOn(AccountingSettingsRepository, "putIfAbsent");

    await expect(
      AccountingSettingsService.backfillOrganization({
        apply: false,
        orgId: "org-123",
      }),
    ).resolves.toMatchObject({ outcome: "WOULD_CREATE" });
    expect(put).not.toHaveBeenCalled();
  });

  test("reports a mismatch without overwriting AccountingSettings", async () => {
    jest
      .spyOn(AccountingSettingsRepository, "getAccountingSettings")
      .mockResolvedValue(settings("SYCEBNL"));
    jest
      .spyOn(AccountingSettingsRepository, "getLegacyOrganizationConfiguration")
      .mockResolvedValue({
        accountingFramework: "SYSCOHADA_REVISED",
        organizationExists: true,
      });
    const put = jest.spyOn(AccountingSettingsRepository, "putIfAbsent");

    await expect(
      AccountingSettingsService.backfillOrganization({
        apply: true,
        orgId: "org-123",
      }),
    ).resolves.toEqual({
      accountingSettingsFramework: "SYCEBNL",
      legacyFramework: "SYSCOHADA_REVISED",
      orgId: "org-123",
      outcome: "MISMATCH",
    });
    expect(put).not.toHaveBeenCalled();
  });

  test("is idempotent when the existing value matches", async () => {
    jest
      .spyOn(AccountingSettingsRepository, "getAccountingSettings")
      .mockResolvedValue(settings("SYSCOHADA_REVISED"));
    jest
      .spyOn(AccountingSettingsRepository, "getLegacyOrganizationConfiguration")
      .mockResolvedValue({
        accountingFramework: "SYSCOHADA_REVISED",
        organizationExists: true,
      });

    await expect(
      AccountingSettingsService.backfillOrganization({
        apply: true,
        orgId: "org-123",
      }),
    ).resolves.toMatchObject({ outcome: "UNCHANGED" });
  });

  test.each([
    [{ organizationExists: false }, "ORGANIZATION_NOT_FOUND"],
    [{ organizationExists: true }, "LEGACY_FRAMEWORK_MISSING"],
    [
      { accountingFramework: "IFRS", organizationExists: true },
      "LEGACY_FRAMEWORK_INVALID",
    ],
  ] as const)("reports invalid legacy source data", async (legacy, outcome) => {
    jest
      .spyOn(AccountingSettingsRepository, "getAccountingSettings")
      .mockResolvedValue(null);
    jest
      .spyOn(AccountingSettingsRepository, "getLegacyOrganizationConfiguration")
      .mockResolvedValue(legacy);

    await expect(
      AccountingSettingsService.backfillOrganization({
        apply: true,
        orgId: "org-123",
      }),
    ).resolves.toMatchObject({ outcome });
  });
});
