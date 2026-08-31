import {
  AddSalesInvoiceLineRequestSchema,
  CreateSalesInvoiceRequestSchema,
  ListSalesInvoicesRequestSchema,
  SalesInvoiceListResponseSchema,
  SalesInvoiceQuantitySchema,
  SalesInvoiceSchema,
  SalesInvoiceTaxRateSchema,
  SalesInvoiceUnitPriceSchema,
  UpdateSalesInvoiceLineRequestSchema,
  UpdateSalesInvoiceRequestSchema,
} from "@liass-ohada/shared/sales";

const timestamp = "2026-08-28T10:00:00.000Z";
const draft = {
  id: "SINV-1",
  status: "DRAFT" as const,
  currency: "XOF",
  lines: [],
  subtotal: "0",
  taxTotal: "0",
  total: "0",
  lineCount: 0,
  version: 1,
  createdAt: timestamp,
  updatedAt: timestamp,
};

describe("SALES Draft Invoice shared contracts", () => {
  test("validates DRAFT only and exposes no persistence or official fields", () => {
    expect(SalesInvoiceSchema.parse(draft)).toEqual(draft);
    for (const invalid of [
      { ...draft, status: "ISSUED" },
      { ...draft, invoiceNumber: "F-1" },
      { ...draft, PK: "ORG#org-1" },
      { ...draft, SK: "SALES_INVOICE#SINV-1" },
    ]) {
      expect(SalesInvoiceSchema.safeParse(invalid).success).toBe(false);
    }
  });

  test("create permits an empty draft, customer, or currency but rejects server fields", () => {
    expect(CreateSalesInvoiceRequestSchema.parse({})).toEqual({});
    expect(
      CreateSalesInvoiceRequestSchema.parse({
        customerId: "SC-1",
        currency: "EUR",
      }),
    ).toEqual({ customerId: "SC-1", currency: "EUR" });
    for (const field of ["status", "invoiceNumber", "total", "lines", "version", "orgId"]) {
      expect(
        CreateSalesInvoiceRequestSchema.safeParse({ [field]: "forbidden" })
          .success,
      ).toBe(false);
    }
  });

  test.each(["1", "1.5", "0.000001", "999999999999999999.999999"])(
    "accepts valid quantity %s",
    (value) => expect(SalesInvoiceQuantitySchema.parse(value)).toBe(value),
  );

  test.each(["0", "-1", "1e2", "+1", " 1", "1,5", "01", "0.0000001"])(
    "rejects invalid quantity %s",
    (value) => expect(SalesInvoiceQuantitySchema.safeParse(value).success).toBe(false),
  );

  test("validates exact price and generic percentage-rate strings", () => {
    expect(SalesInvoiceUnitPriceSchema.parse("0")).toBe("0");
    expect(SalesInvoiceUnitPriceSchema.parse("19.990000")).toBe("19.990000");
    expect(SalesInvoiceUnitPriceSchema.safeParse("-0.01").success).toBe(false);
    expect(SalesInvoiceTaxRateSchema.parse("100.0000")).toBe("100.0000");
    for (const rate of ["100.0001", "101", "-1", "18e0", "18.00000"])
      expect(SalesInvoiceTaxRateSchema.safeParse(rate).success).toBe(false);
  });

  test("enforces free-form and catalog-backed line semantics", () => {
    expect(
      AddSalesInvoiceLineRequestSchema.parse({
        expectedVersion: 1,
        description: "Déplacement",
        quantity: "1",
        unitPrice: "100",
      }),
    ).toMatchObject({ description: "Déplacement" });
    expect(
      AddSalesInvoiceLineRequestSchema.parse({
        expectedVersion: 1,
        catalogItemId: "SI-1",
        quantity: "1",
        unitPrice: "100",
      }),
    ).toMatchObject({ catalogItemId: "SI-1" });
    expect(
      AddSalesInvoiceLineRequestSchema.safeParse({
        expectedVersion: 1,
        quantity: "1",
        unitPrice: "100",
      }).success,
    ).toBe(false);
  });

  test("update contracts distinguish customer clearing and reject line source/calculated fields", () => {
    expect(
      UpdateSalesInvoiceRequestSchema.parse({
        expectedVersion: 1,
        customerId: null,
      }),
    ).toEqual({ expectedVersion: 1, customerId: null });
    expect(
      UpdateSalesInvoiceRequestSchema.safeParse({ expectedVersion: 1 }).success,
    ).toBe(false);
    expect(
      UpdateSalesInvoiceLineRequestSchema.parse({
        expectedVersion: 1,
        quantity: "2",
      }),
    ).toEqual({ expectedVersion: 1, quantity: "2" });
    for (const field of ["catalogItemId", "position", "subtotal", "taxAmount", "total"]) {
      expect(
        UpdateSalesInvoiceLineRequestSchema.safeParse({
          expectedVersion: 1,
          [field]: "forbidden",
        }).success,
      ).toBe(false);
    }
  });

  test("validates summary pagination without line payloads", () => {
    expect(ListSalesInvoicesRequestSchema.parse({})).toEqual({ limit: 50 });
    expect(ListSalesInvoicesRequestSchema.parse({ limit: "25" })).toEqual({ limit: 25 });
    expect(() => ListSalesInvoicesRequestSchema.parse({ limit: 101 })).toThrow();
    const { lines: _lines, ...summary } = draft;
    expect(
      SalesInvoiceListResponseSchema.parse({ items: [summary], nextCursor: "next" }),
    ).toMatchObject({ nextCursor: "next" });
  });
});
