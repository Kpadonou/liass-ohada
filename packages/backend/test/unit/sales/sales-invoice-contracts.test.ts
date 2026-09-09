import {
  AddSalesInvoiceLineRequestSchema,
  CreateSalesInvoiceRequestSchema,
  IssueSalesInvoiceRequestSchema,
  ListSalesInvoicesRequestSchema,
  SalesInvoiceListResponseSchema,
  SalesInvoiceQuantitySchema,
  SalesInvoiceSchema,
  SalesInvoiceIssueDateSchema,
  SalesInvoiceSummarySchema,
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

describe("SALES Invoice shared contracts", () => {
  test("validates discriminated DRAFT and ISSUED invoices", () => {
    expect(SalesInvoiceSchema.parse(draft)).toEqual(draft);
    for (const invalid of [
      { ...draft, invoiceNumber: "F-1" },
      { ...draft, issueDate: "2026-09-08" },
      { ...draft, issuedAt: timestamp },
      { ...draft, PK: "ORG#org-1" },
      { ...draft, SK: "SALES_INVOICE#SINV-1" },
    ]) {
      expect(SalesInvoiceSchema.safeParse(invalid).success).toBe(false);
    }

    const issued = {
      ...draft,
      status: "ISSUED" as const,
      lines: [{
        id: "SIL-1", position: 1, description: "Service", quantity: "1",
        unitPrice: "0", taxRate: "0", subtotal: "0", taxAmount: "0",
        total: "0", createdAt: timestamp, updatedAt: timestamp,
      }],
      lineCount: 1,
      invoiceNumber: "00000001",
      issueDate: "2026-09-08",
      issuedAt: timestamp,
      version: 2,
    };
    expect(SalesInvoiceSchema.parse(issued)).toEqual(issued);
    for (const field of ["invoiceNumber", "issueDate", "issuedAt"] as const) {
      const invalid = { ...issued };
      delete invalid[field];
      expect(SalesInvoiceSchema.safeParse(invalid).success).toBe(false);
    }
  });

  test("validates real date-only issue dates without timezone conversion", () => {
    for (const value of ["2024-02-29", "2020-01-01", "2099-12-31"]) {
      expect(SalesInvoiceIssueDateSchema.parse(value)).toBe(value);
    }
    for (const value of ["2026-2-03", "2026-02-30", "2025-02-29", "2026-09-08T00:00:00Z"]) {
      expect(SalesInvoiceIssueDateSchema.safeParse(value).success).toBe(false);
    }
  });

  test("accepts only the three client-owned Issue fields", () => {
    const request = {
      expectedVersion: 1,
      clientRequestId: "243dc17a-6c2b-4e2d-87b8-2ad2ae9f12da",
      issueDate: "2026-09-08",
    };
    expect(IssueSalesInvoiceRequestSchema.parse(request)).toEqual(request);
    for (const field of ["expectedVersion", "clientRequestId", "issueDate"] as const) {
      const invalid = { ...request } as Record<string, unknown>;
      delete invalid[field];
      expect(IssueSalesInvoiceRequestSchema.safeParse(invalid).success).toBe(false);
    }
    for (const field of ["invoiceNumber", "issuedAt", "issuedByUserId", "status", "lines", "total"]) {
      expect(IssueSalesInvoiceRequestSchema.safeParse({ ...request, [field]: "forbidden" }).success).toBe(false);
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
    expect(
      UpdateSalesInvoiceLineRequestSchema.parse({
        expectedVersion: 1,
        unit: null,
      }),
    ).toEqual({ expectedVersion: 1, unit: null });
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
    expect(SalesInvoiceSummarySchema.safeParse({ ...summary, status: "ISSUED" }).success).toBe(false);
    expect(SalesInvoiceSummarySchema.parse({
      ...summary,
      status: "ISSUED",
      invoiceNumber: "00000042",
      issueDate: "2026-09-08",
      lineCount: 1,
    })).toMatchObject({ status: "ISSUED", invoiceNumber: "00000042" });
  });
});
