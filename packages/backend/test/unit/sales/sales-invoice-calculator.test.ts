import { SalesInvoiceCalculator } from "@/lambda/domains/sales/invoices/sales-invoice-calculator";

const line = (
  currency: string,
  quantity: string,
  unitPrice: string,
  taxRate = "0",
) =>
  SalesInvoiceCalculator.calculateLine(currency, {
    id: "SIL-1",
    position: 1,
    description: "Service",
    quantity,
    unitPrice,
    taxRate,
    createdAt: "2026-08-28T10:00:00.000Z",
    updatedAt: "2026-08-28T10:00:00.000Z",
  });

describe("SalesInvoiceCalculator", () => {
  test.each(["XOF", "XAF"])("uses zero-decimal HALF_UP rules for %s", (currency) => {
    expect(line(currency, "2", "25000", "18")).toMatchObject({
      quantity: "2",
      unitPrice: "25000",
      taxRate: "18",
      subtotal: "50000",
      taxAmount: "9000",
      total: "59000",
    });
  });

  test.each(["EUR", "USD"])("rounds fractional multiplication for %s", (currency) => {
    expect(line(currency, "1.5", "19.99", "18")).toMatchObject({
      subtotal: "29.99",
      taxAmount: "5.4",
      total: "35.39",
    });
  });

  test("rounds x.xx5 HALF_UP and supports zero values and 100 percent tax", () => {
    expect(line("EUR", "1", "1.005")).toMatchObject({ subtotal: "1.01" });
    expect(line("EUR", "2", "0", "100")).toMatchObject({
      subtotal: "0",
      taxAmount: "0",
      total: "0",
    });
    expect(line("EUR", "1", "10", "100")).toMatchObject({
      taxAmount: "10",
      total: "20",
    });
  });

  test("accepts maximum scales and normalizes without floating-point artifacts", () => {
    const result = line("USD", "0.000001", "300000", "0.0001");
    expect(result.quantity).toBe("0.000001");
    expect(result.subtotal).toBe("0.3");
    expect(JSON.stringify(result)).not.toContain("0.30000000000000004");
  });

  test("sums canonical rounded line amounts rather than globally recalculating tax", () => {
    const first = line("EUR", "1", "0.05", "10");
    const second = { ...line("EUR", "1", "0.05", "10"), id: "SIL-2", position: 2 };
    expect(first.taxAmount).toBe("0.01");
    expect(SalesInvoiceCalculator.calculateTotals("EUR", [first, second])).toEqual({
      subtotal: "0.1",
      taxTotal: "0.02",
      total: "0.12",
    });
    expect(SalesInvoiceCalculator.calculateTotals("EUR", [])).toEqual({
      subtotal: "0",
      taxTotal: "0",
      total: "0",
    });
  });

  test("rejects unsupported currencies without guessing a scale", () => {
    expect(() => line("ZZZ", "1", "1")).toThrow(
      expect.objectContaining({ messageCode: "UNSUPPORTED_CURRENCY" }),
    );
  });
});
