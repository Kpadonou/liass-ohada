import {
  CreateSalesCustomerRequestSchema,
  ListSalesCustomersRequestSchema,
  SalesCustomerListResponseSchema,
  SalesCustomerSchema,
  UpdateSalesCustomerRequestSchema,
} from "@liass-ohada/shared/sales";

const timestamp = "2026-08-28T10:00:00.000Z";

describe("SALES Customer shared contracts", () => {
  test.each(["BUSINESS", "INDIVIDUAL"] as const)(
    "validates a %s customer and trims optional identity fields",
    (customerType) => {
      expect(
        CreateSalesCustomerRequestSchema.parse({
          customerType,
          name: "  Client Demo  ",
          taxIdentifier: "  generic-identifier  ",
          billingAddress: { city: "  Cotonou ", country: "BJ" },
        }),
      ).toEqual({
        customerType,
        name: "Client Demo",
        taxIdentifier: "generic-identifier",
        billingAddress: { city: "Cotonou", country: "BJ" },
      });
    },
  );

  test("rejects blank names, invalid types, invalid emails, and server fields", () => {
    expect(() =>
      CreateSalesCustomerRequestSchema.parse({
        customerType: "BUSINESS",
        name: "   ",
      }),
    ).toThrow();
    expect(() =>
      CreateSalesCustomerRequestSchema.parse({
        customerType: "PUBLIC_BODY",
        name: "Client",
      }),
    ).toThrow();
    expect(() =>
      CreateSalesCustomerRequestSchema.parse({
        customerType: "BUSINESS",
        name: "Client",
        email: "invalid",
      }),
    ).toThrow();
    expect(() =>
      CreateSalesCustomerRequestSchema.parse({
        customerType: "BUSINESS",
        name: "Client",
        id: "client-controlled",
      }),
    ).toThrow();
  });

  test("requires a positive expectedVersion and one mutable update field", () => {
    expect(
      UpdateSalesCustomerRequestSchema.parse({
        expectedVersion: 2,
        phone: " +229 00 00 ",
      }),
    ).toEqual({ expectedVersion: 2, phone: "+229 00 00" });
    expect(() =>
      UpdateSalesCustomerRequestSchema.parse({ expectedVersion: 2 }),
    ).toThrow();
    expect(() =>
      UpdateSalesCustomerRequestSchema.parse({
        expectedVersion: 0,
        name: "Client",
      }),
    ).toThrow();
  });

  test("keeps persistence fields outside the strict DTO", () => {
    expect(
      SalesCustomerSchema.safeParse({
        id: "SC-1",
        customerType: "BUSINESS",
        name: "Client",
        isActive: true,
        version: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
        PK: "ORG#org-123",
      }).success,
    ).toBe(false);
  });

  test("validates paginated requests and responses", () => {
    expect(ListSalesCustomersRequestSchema.parse({ limit: "25" })).toEqual({
      limit: 25,
    });
    expect(
      SalesCustomerListResponseSchema.parse({
        items: [
          {
            id: "SC-1",
            customerType: "INDIVIDUAL",
            name: "Jean Koffi",
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
