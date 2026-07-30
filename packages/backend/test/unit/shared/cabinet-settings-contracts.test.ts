import {
  CabinetAddressSchema,
  CabinetContactSchema,
  CabinetSettingsSchema,
  UpdateCabinetSettingsRequestSchema,
} from "@liass-ohada/shared/shared";

describe("Cabinet settings shared contracts", () => {
  test("accepts and normalizes a complete frontend-safe response", () => {
    expect(
      CabinetSettingsSchema.parse({
        cabinetOrgId: "org-cabinet",
        organizationName: " Cabinet Kora ",
        country: "BJ",
        contact: {
          email: " contact@example.com ",
          phone: " +229 01 23 45 67 89 ",
          website: " https://example.com ",
        },
        address: { line1: " Rue 1 ", city: " Cotonou " },
        preferredLanguage: "fr",
        defaults: {
          country: "SN",
          accountingFramework: "SYSCOHADA_REVISED",
        },
        version: 2,
        updatedAt: "2026-07-30T00:00:00.000Z",
      }),
    ).toMatchObject({
      organizationName: "Cabinet Kora",
      contact: {
        email: "contact@example.com",
        phone: "+229 01 23 45 67 89",
        website: "https://example.com",
      },
      address: { line1: "Rue 1", city: "Cotonou" },
    });
  });

  test.each(["javascript:alert(1)", "file:///tmp/site", "ftp://example.com"])(
    "rejects unsupported website scheme %s",
    (website) => {
      expect(CabinetContactSchema.safeParse({ website }).success).toBe(false);
    },
  );

  test("normalizes blank optional contact fields and accepts international phone punctuation", () => {
    expect(
      CabinetContactSchema.parse({
        email: " ",
        phone: "+225 (01) 23-45-67",
        website: "",
      }),
    ).toEqual({ email: undefined, phone: "+225 (01) 23-45-67", website: undefined });
  });

  test("accepts a partial address and rejects overlong values", () => {
    expect(CabinetAddressSchema.parse({ city: "  Lomé " })).toEqual({
      city: "Lomé",
    });
    expect(
      CabinetAddressSchema.safeParse({ line1: "x".repeat(201) }).success,
    ).toBe(false);
  });

  test("requires expectedVersion and rejects protected or onboarding fields", () => {
    expect(
      UpdateCabinetSettingsRequestSchema.safeParse({
        expectedVersion: 0,
        preferredLanguage: "en",
        defaults: { country: "CI", accountingFramework: "SYCEBNL" },
      }).success,
    ).toBe(true);
    expect(
      UpdateCabinetSettingsRequestSchema.safeParse({
        preferredLanguage: "en",
      }).success,
    ).toBe(false);
    for (const protectedField of [
      "cabinetOrgId",
      "ownerUserId",
      "version",
      "onboardingSteps",
      "nextStepId",
    ]) {
      expect(
        UpdateCabinetSettingsRequestSchema.safeParse({
          expectedVersion: 0,
          [protectedField]: "forbidden",
        }).success,
      ).toBe(false);
    }
  });

  test("rejects invalid countries, frameworks, language, email, and phone length", () => {
    expect(
      UpdateCabinetSettingsRequestSchema.safeParse({
        expectedVersion: 0,
        country: "FR",
      }).success,
    ).toBe(false);
    expect(
      UpdateCabinetSettingsRequestSchema.safeParse({
        expectedVersion: 0,
        defaults: { accountingFramework: "IFRS" },
      }).success,
    ).toBe(false);
    expect(
      UpdateCabinetSettingsRequestSchema.safeParse({
        expectedVersion: 0,
        preferredLanguage: "pt",
      }).success,
    ).toBe(false);
    expect(CabinetContactSchema.safeParse({ email: "bad" }).success).toBe(false);
    expect(
      CabinetContactSchema.safeParse({ phone: "1".repeat(41) }).success,
    ).toBe(false);
  });
});
