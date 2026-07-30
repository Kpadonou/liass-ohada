import { CabinetAuthorizationService } from "@/lambda/shared/services/cabinet-authorization-service";
import { CabinetSettingsService } from "@/lambda/shared/services/cabinet-settings-service";
import {
  CabinetSettingsConflictError,
  CabinetSettingsRepository,
} from "@/lambda/shared/repositories/cabinet-settings-repository";

const context = {
  orgId: "org-cabinet",
  userId: "admin-2",
  cabinetId: "cab-1",
  workspaceType: "ACCOUNTING_FIRM" as const,
};
const organization = {
  orgId: "org-cabinet",
  name: "Cabinet Kora",
  country: "BJ",
  accountingFramework: "SYSCOHADA_REVISED",
  workspaceType: "ACCOUNTING_FIRM",
  status: "ACTIVE",
  updatedAt: "2026-07-29T00:00:00.000Z",
  raw: {
    PK: "ORG#org-cabinet",
    SK: "ORG#METADATA",
    entityType: "ORGANIZATION",
    orgId: "org-cabinet",
    name: "Cabinet Kora",
    country: "BJ",
    accountingFramework: "SYSCOHADA_REVISED",
    workspaceType: "ACCOUNTING_FIRM",
    status: "ACTIVE",
    ownerUserId: "owner-1",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-29T00:00:00.000Z",
  },
};
const settings = CabinetSettingsRepository.buildInitialItem({
  cabinetOrgId: "org-cabinet",
  country: "BJ",
  accountingFramework: "SYSCOHADA_REVISED",
  actorUserId: "owner-1",
  now: "2026-07-01T00:00:00.000Z",
});

describe("CabinetSettingsService", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.spyOn(console, "info").mockImplementation();
    jest.spyOn(CabinetAuthorizationService, "requireAdmin").mockResolvedValue({
      cabinetOrgId: "org-cabinet",
      cabinetId: "cab-1",
      caller: {
        orgId: "org-cabinet",
        userId: "admin-2",
        cabinetId: "cab-1",
        cabinetRole: "CABINET_ADMIN",
        workspaceType: "ACCOUNTING_FIRM",
        status: "ACTIVE",
        updatedAt: "2026-07-30T00:00:00.000Z",
      },
    });
    jest
      .spyOn(CabinetSettingsRepository, "getOrganization")
      .mockResolvedValue(organization);
  });

  test("allows a non-owner active administrator and synthesizes legacy defaults without writing", async () => {
    jest
      .spyOn(CabinetSettingsRepository, "getCabinetSettings")
      .mockResolvedValue(undefined);
    const transact = jest
      .spyOn(CabinetSettingsRepository, "transactUpdate")
      .mockResolvedValue();
    await expect(CabinetSettingsService.getSettings(context)).resolves.toEqual({
      cabinetOrgId: "org-cabinet",
      organizationName: "Cabinet Kora",
      country: "BJ",
      contact: {},
      address: {},
      preferredLanguage: "fr",
      defaults: {
        country: "BJ",
        accountingFramework: "SYSCOHADA_REVISED",
      },
      version: 0,
    });
    expect(transact).not.toHaveBeenCalled();
  });

  test("rejects stale versions before any write", async () => {
    jest
      .spyOn(CabinetSettingsRepository, "getCabinetSettings")
      .mockResolvedValue(settings);
    const transact = jest
      .spyOn(CabinetSettingsRepository, "transactUpdate")
      .mockResolvedValue();
    await expect(
      CabinetSettingsService.updateSettings(context, {
        expectedVersion: 0,
        preferredLanguage: "en",
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      messageCode: "CABINET_SETTINGS_UPDATE_CONFLICT",
    });
    expect(transact).not.toHaveBeenCalled();
  });

  test("creates legacy settings with version one and atomically updates canonical fields", async () => {
    jest
      .spyOn(CabinetSettingsRepository, "getCabinetSettings")
      .mockResolvedValue(undefined);
    const transact = jest
      .spyOn(CabinetSettingsRepository, "transactUpdate")
      .mockResolvedValue();
    const result = await CabinetSettingsService.updateSettings(context, {
      expectedVersion: 0,
      organizationName: "Cabinet Kora Conseil",
      country: "SN",
      contact: { email: "office@example.com" },
      preferredLanguage: "en",
      defaults: { country: "CI", accountingFramework: "SYCEBNL" },
    });

    expect(result).toMatchObject({
      organizationName: "Cabinet Kora Conseil",
      country: "SN",
      contact: { email: "office@example.com" },
      preferredLanguage: "en",
      defaults: { country: "CI", accountingFramework: "SYCEBNL" },
      version: 1,
    });
    expect(transact).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedVersion: 0,
        organizationChanges: {
          name: "Cabinet Kora Conseil",
          country: "SN",
        },
        settings: expect.objectContaining({
          PK: "ORG#org-cabinet",
          SK: "SETTINGS#CABINET",
          version: 1,
          createdBy: "admin-2",
          updatedBy: "admin-2",
        }),
      }),
    );
  });

  test("does not silently synchronize the dossier default when Cabinet country changes", async () => {
    jest
      .spyOn(CabinetSettingsRepository, "getCabinetSettings")
      .mockResolvedValue(settings);
    const transact = jest
      .spyOn(CabinetSettingsRepository, "transactUpdate")
      .mockResolvedValue();
    const result = await CabinetSettingsService.updateSettings(context, {
      expectedVersion: 1,
      country: "SN",
    });
    expect(result.country).toBe("SN");
    expect(result.defaults.country).toBe("BJ");
    expect(transact).toHaveBeenCalledWith(
      expect.objectContaining({
        settings: expect.objectContaining({ defaultClientCountry: "BJ" }),
      }),
    );
  });

  test("clears blank optional contact values and preserves omitted settings", async () => {
    jest
      .spyOn(CabinetSettingsRepository, "getCabinetSettings")
      .mockResolvedValue({
        ...settings,
        contact: { email: "old@example.com", phone: "+229 123" },
        address: { city: "Cotonou" },
      });
    jest
      .spyOn(CabinetSettingsRepository, "transactUpdate")
      .mockResolvedValue();
    const result = await CabinetSettingsService.updateSettings(context, {
      expectedVersion: 1,
      contact: { email: "" },
    } as never);
    expect(result.contact).toEqual({ phone: "+229 123" });
    expect(result.address).toEqual({ city: "Cotonou" });
  });

  test("returns a no-op without incrementing version or writing", async () => {
    jest
      .spyOn(CabinetSettingsRepository, "getCabinetSettings")
      .mockResolvedValue(settings);
    const transact = jest
      .spyOn(CabinetSettingsRepository, "transactUpdate")
      .mockResolvedValue();
    const result = await CabinetSettingsService.updateSettings(context, {
      expectedVersion: 1,
      organizationName: "Cabinet Kora",
    });
    expect(result.version).toBe(1);
    expect(transact).not.toHaveBeenCalled();
  });

  test("maps a concurrent conditional failure to the stable conflict code", async () => {
    jest
      .spyOn(CabinetSettingsRepository, "getCabinetSettings")
      .mockResolvedValue(settings);
    jest
      .spyOn(CabinetSettingsRepository, "transactUpdate")
      .mockRejectedValue(new CabinetSettingsConflictError());
    await expect(
      CabinetSettingsService.updateSettings(context, {
        expectedVersion: 1,
        preferredLanguage: "en",
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      messageCode: "CABINET_SETTINGS_UPDATE_CONFLICT",
    });
  });
});
