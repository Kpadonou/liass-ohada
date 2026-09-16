import { SalesCreditNoteCalculator } from "@/lambda/domains/sales/invoices/sales-credit-note-calculator";
import { SalesReceivableCalculator } from "@/lambda/domains/sales/invoices/sales-receivable-calculator";

const timestamp = "2026-09-10T10:00:00.000Z";
const line = { id: "SIL-1", position: 1, description: "Service", quantity: "1.5",
  unitPrice: "19.99", taxRate: "18", subtotal: "29.99", taxAmount: "5.4", total: "35.39",
  createdAt: timestamp, updatedAt: timestamp };

describe("SalesCreditNoteCalculator", () => {
  test("reuses exact per-line ROUND_HALF_UP semantics and full quantity matches Invoice line", () => {
    expect(SalesCreditNoteCalculator.calculateLine({ currency: "EUR", id: "SCL-1", originalLine: line,
      position: 1, quantity: "1.5", timestamp })).toMatchObject({
      originalInvoiceLineId: "SIL-1", description: "Service", unitPrice: "19.99",
      taxRate: "18", subtotal: "29.99", taxAmount: "5.4", total: "35.39",
    });
  });

  test("compares and accumulates quantities without Number", () => {
    expect(SalesCreditNoteCalculator.addQuantities("3.125", "6.875")).toBe("10");
    expect(SalesCreditNoteCalculator.compareQuantity("10.000000", "10")).toBe(0);
    expect(() => SalesCreditNoteCalculator.calculateLine({ currency: "EUR", id: "SCL-1",
      originalLine: line, position: 1, quantity: "1.500001", timestamp }))
      .toThrow(expect.objectContaining({ messageCode: "SALES_CREDIT_NOTE_QUANTITY_EXCEEDS_SOURCE" }));
  });

  test("credit changes only credit settlement dimensions and supports mixed settlement", () => {
    const initial = SalesReceivableCalculator.synthetic({ invoiceId: "SINV-1", currency: "XOF",
      invoiceAmount: "100000", timestamp });
    const afterPayment = SalesReceivableCalculator.applyPayment(initial, "30000", timestamp).receivable;
    const afterCredit = SalesReceivableCalculator.applyCredit(afterPayment, "20000", timestamp);
    expect(afterCredit).toMatchObject({ amountPaid: "30000", creditedAmount: "20000",
      balanceDue: "50000", status: "PARTIALLY_SETTLED", paymentCount: 1, version: 2 });
    expect(SalesReceivableCalculator.applyCredit(initial, "100000", timestamp))
      .toMatchObject({ amountPaid: "0", creditedAmount: "100000", balanceDue: "0", status: "SETTLED" });
  });
});
