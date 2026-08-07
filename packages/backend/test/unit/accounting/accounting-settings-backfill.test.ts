import {
  parseAccountingSettingsBackfillArgs,
  runAccountingSettingsBackfill,
} from "@/scripts/backfill-accounting-settings";
import { AccountingSettingsService } from "@/lambda/domains/accounting/settings/accounting-settings-service";

describe("AccountingSettings backfill CLI", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.spyOn(console, "info").mockImplementation(() => undefined);
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  test("requires explicit organization IDs and defaults to dry-run", () => {
    expect(() => parseAccountingSettingsBackfillArgs([])).toThrow(
      "Provide at least one",
    );
    expect(
      parseAccountingSettingsBackfillArgs([
        "--org-id",
        "org-1",
        "--org-id",
        "org-1",
        "--org-id",
        "org-2",
      ]),
    ).toEqual({ apply: false, orgIds: ["org-1", "org-2"] });
  });

  test("passes dry-run mode to the migration service", async () => {
    const backfill = jest
      .spyOn(AccountingSettingsService, "backfillOrganization")
      .mockResolvedValue({ orgId: "org-1", outcome: "WOULD_CREATE" });

    await runAccountingSettingsBackfill({
      apply: false,
      orgIds: ["org-1"],
    });
    expect(backfill).toHaveBeenCalledWith({ apply: false, orgId: "org-1" });
  });

  test("requires explicit apply mode before writes are requested", async () => {
    const backfill = jest
      .spyOn(AccountingSettingsService, "backfillOrganization")
      .mockResolvedValue({ orgId: "org-1", outcome: "CREATED" });

    await runAccountingSettingsBackfill({
      apply: true,
      orgIds: ["org-1"],
    });
    expect(backfill).toHaveBeenCalledWith({ apply: true, orgId: "org-1" });
  });

  test("warns when settings and legacy Organization disagree", async () => {
    jest
      .spyOn(AccountingSettingsService, "backfillOrganization")
      .mockResolvedValue({
        accountingSettingsFramework: "SYCEBNL",
        legacyFramework: "SYSCOHADA_REVISED",
        orgId: "org-1",
        outcome: "MISMATCH",
      });
    const warn = jest.spyOn(console, "warn");

    await runAccountingSettingsBackfill({ apply: true, orgIds: ["org-1"] });
    expect(warn).toHaveBeenCalledWith(
      "[ACCOUNTING_SETTINGS_BACKFILL]",
      expect.objectContaining({ outcome: "MISMATCH" }),
    );
  });
});
