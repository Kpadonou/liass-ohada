import {
  ProductAccessSchema,
  ProductAccessStatusSchema,
  ProductCodeSchema,
} from "@liass-ohada/shared/shared";
import {
  CurrencyCodeSchema,
  SalesSettingsSchema,
} from "@liass-ohada/shared/sales";

const validProductAccess = {
  orgId: "org-123",
  productCode: "ACCOUNTING",
  status: "ACTIVE",
  createdAt: "2026-08-07T10:00:00.000Z",
  updatedAt: "2026-08-07T10:00:00.000Z",
};

describe("ProductAccess shared contracts", () => {
  test.each(["ACCOUNTING", "SALES"])(
    "accepts canonical top-level product code %s",
    (productCode) => {
      expect(ProductCodeSchema.parse(productCode)).toBe(productCode);
    },
  );

  test("validates frontend-safe SalesSettings with a structural ISO currency code", () => {
    const settings = {
      orgId: "org-123",
      defaultCurrency: "XOF",
      version: 1,
      createdAt: "2026-08-28T10:00:00.000Z",
      updatedAt: "2026-08-28T10:00:00.000Z",
    };

    expect(SalesSettingsSchema.parse(settings)).toEqual(settings);
    expect(CurrencyCodeSchema.safeParse("usd").success).toBe(false);
    expect(CurrencyCodeSchema.safeParse("EURO").success).toBe(false);
    expect(
      SalesSettingsSchema.safeParse({ ...settings, PK: "ORG#org-123" }).success,
    ).toBe(false);
  });

  test("rejects unknown product codes", () => {
    expect(ProductCodeSchema.safeParse("RESTAURANTS").success).toBe(false);
  });

  test.each(["PROJECTS", "TREASURY"])(
    "rejects legacy module code %s from the public contract",
    (productCode) => {
      expect(ProductCodeSchema.safeParse(productCode).success).toBe(false);
    },
  );

  test.each(["ACTIVE", "INACTIVE"])("accepts status %s", (status) => {
    expect(ProductAccessStatusSchema.parse(status)).toBe(status);
  });

  test.each(["PK", "SK", "GSI1PK", "entityType"])(
    "rejects persistence field %s",
    (field) => {
      expect(
        ProductAccessSchema.safeParse({
          ...validProductAccess,
          [field]: "internal",
        }).success,
      ).toBe(false);
    },
  );
});
