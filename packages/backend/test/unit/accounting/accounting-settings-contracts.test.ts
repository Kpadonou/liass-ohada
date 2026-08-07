import {
  AccountingSettingsSchema,
  AccountingFramework,
} from "@liass-ohada/shared/accounting";

const validSettings = {
  orgId: "org-123",
  accountingFramework: "SYSCOHADA_REVISED",
  createdAt: "2026-08-07T10:00:00.000Z",
  updatedAt: "2026-08-07T10:00:00.000Z",
};

describe("AccountingSettings shared contract", () => {
  test.each(["SYSCOHADA_REVISED", "SYCEBNL"])(
    "accepts the existing framework %s",
    (accountingFramework) => {
      expect(AccountingFramework.parse(accountingFramework)).toBe(
        accountingFramework,
      );
      expect(
        AccountingSettingsSchema.parse({
          ...validSettings,
          accountingFramework,
        }).accountingFramework,
      ).toBe(accountingFramework);
    },
  );

  test("rejects an unknown accounting framework", () => {
    expect(
      AccountingSettingsSchema.safeParse({
        ...validSettings,
        accountingFramework: "IFRS",
      }).success,
    ).toBe(false);
  });

  test.each(["PK", "SK", "GSI1PK", "entityType"])(
    "rejects persistence field %s",
    (field) => {
      expect(
        AccountingSettingsSchema.safeParse({
          ...validSettings,
          [field]: "internal",
        }).success,
      ).toBe(false);
    },
  );
});
