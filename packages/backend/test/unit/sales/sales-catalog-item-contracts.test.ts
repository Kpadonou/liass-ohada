import {
  CreateSalesCatalogItemRequestSchema,
  ListSalesCatalogItemsRequestSchema,
  SalesCatalogItemListResponseSchema,
  SalesCatalogItemSchema,
  UpdateSalesCatalogItemRequestSchema,
} from "@liass-ohada/shared/sales";

const timestamp = "2026-08-28T10:00:00.000Z";

describe("SALES Catalog Item shared contracts", () => {
  test.each(["PRODUCT", "SERVICE"] as const)(
    "validates a %s and trims business fields",
    (itemType) => {
      expect(
        CreateSalesCatalogItemRequestSchema.parse({
          itemType,
          name: "  Formation  ",
          description: "  Formation pratique  ",
          unit: "  Jour  ",
        }),
      ).toEqual({
        itemType,
        name: "Formation",
        description: "Formation pratique",
        unit: "Jour",
      });
    },
  );

  test("rejects blank names, invalid types, oversized optional fields, and server fields", () => {
    expect(() =>
      CreateSalesCatalogItemRequestSchema.parse({
        itemType: "PRODUCT",
        name: "   ",
      }),
    ).toThrow();
    expect(() =>
      CreateSalesCatalogItemRequestSchema.parse({
        itemType: "SUBSCRIPTION",
        name: "Abonnement",
      }),
    ).toThrow();
    expect(() =>
      CreateSalesCatalogItemRequestSchema.parse({
        itemType: "SERVICE",
        name: "Conseil",
        description: "x".repeat(2001),
      }),
    ).toThrow();
    expect(() =>
      CreateSalesCatalogItemRequestSchema.parse({
        itemType: "PRODUCT",
        name: "Article",
        price: 1000,
      }),
    ).toThrow();
    expect(() =>
      CreateSalesCatalogItemRequestSchema.parse({
        itemType: "PRODUCT",
        name: "Article",
        taxRate: 18,
      }),
    ).toThrow();
    expect(() =>
      CreateSalesCatalogItemRequestSchema.parse({
        itemType: "PRODUCT",
        name: "Article",
        stockQuantity: 5,
      }),
    ).toThrow();
    expect(() =>
      CreateSalesCatalogItemRequestSchema.parse({
        itemType: "PRODUCT",
        name: "Article",
        id: "client-controlled",
      }),
    ).toThrow();
  });

  test("normalizes blank optional fields and requires a meaningful versioned update", () => {
    expect(
      UpdateSalesCatalogItemRequestSchema.parse({
        expectedVersion: 2,
        description: " ",
        unit: " Heure ",
      }),
    ).toEqual({ expectedVersion: 2, description: undefined, unit: "Heure" });
    expect(() =>
      UpdateSalesCatalogItemRequestSchema.parse({ expectedVersion: 2 }),
    ).toThrow();
    expect(() =>
      UpdateSalesCatalogItemRequestSchema.parse({
        expectedVersion: 0,
        name: "Article",
      }),
    ).toThrow();
    expect(() =>
      UpdateSalesCatalogItemRequestSchema.parse({
        expectedVersion: 1,
        isActive: false,
      }),
    ).toThrow();
  });

  test("keeps persistence and excluded business fields outside the strict DTO", () => {
    expect(
      SalesCatalogItemSchema.safeParse({
        id: "SI-1",
        itemType: "PRODUCT",
        name: "Article",
        isActive: true,
        version: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
        PK: "ORG#org-123",
      }).success,
    ).toBe(false);
  });

  test("validates cursor pagination with default 50 and maximum 100", () => {
    expect(ListSalesCatalogItemsRequestSchema.parse({})).toEqual({ limit: 50 });
    expect(ListSalesCatalogItemsRequestSchema.parse({ limit: "25" })).toEqual({
      limit: 25,
    });
    expect(() =>
      ListSalesCatalogItemsRequestSchema.parse({ limit: 101 }),
    ).toThrow();
    expect(
      SalesCatalogItemListResponseSchema.parse({
        items: [
          {
            id: "SI-1",
            itemType: "SERVICE",
            name: "Conseil",
            isActive: true,
            version: 1,
            createdAt: timestamp,
            updatedAt: timestamp,
          },
        ],
        nextCursor: "cursor",
      }),
    ).toHaveProperty("nextCursor", "cursor");
  });
});
