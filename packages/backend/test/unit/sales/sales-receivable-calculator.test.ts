import { SalesReceivableCalculator } from "@/lambda/domains/sales/invoices/sales-receivable-calculator";

const timestamp = "2026-09-10T10:00:00.000Z";
const receivable = (currency: string, invoiceAmount: string, amountPaid = "0") => {
  const initial = SalesReceivableCalculator.synthetic({
    invoiceId: "SINV-1", currency, invoiceAmount, timestamp,
  });
  if (amountPaid === "0") return initial;
  return SalesReceivableCalculator.applyPayment(initial, amountPaid, timestamp).receivable;
};

describe("SalesReceivableCalculator", () => {
  test("calculates XOF partial and full payments exactly", () => {
    const partial = SalesReceivableCalculator.applyPayment(
      receivable("XOF", "100000"), "30000", timestamp,
    ).receivable;
    expect(partial).toMatchObject({
      amountPaid: "30000", balanceDue: "70000", status: "PARTIALLY_PAID", version: 1,
    });
    const paid = SalesReceivableCalculator.applyPayment(partial, "70000", timestamp).receivable;
    expect(paid).toMatchObject({ amountPaid: "100000", balanceDue: "0", status: "PAID", version: 2 });
  });

  test("calculates EUR decimals with no floating-point artifact", () => {
    const result = SalesReceivableCalculator.applyPayment(
      receivable("EUR", "100.50"), "20.25", timestamp,
    );
    expect(result.amount).toBe("20.25");
    expect(result.receivable.balanceDue).toBe("80.25");
    expect(JSON.stringify(result)).not.toContain("0.30000000000000004");
  });

  test("derives zero-total Invoice as paid without a Payment", () => {
    expect(receivable("XOF", "0")).toMatchObject({
      amountPaid: "0", balanceDue: "0", status: "PAID", paymentCount: 0, version: 0,
    });
  });

  test("rejects overpayment and currency precision without rounding", () => {
    expect(() => SalesReceivableCalculator.applyPayment(
      receivable("EUR", "80.25"), "80.26", timestamp,
    )).toThrow(expect.objectContaining({ messageCode: "SALES_PAYMENT_EXCEEDS_BALANCE" }));
    expect(() => SalesReceivableCalculator.applyPayment(
      receivable("XOF", "1000"), "1.5", timestamp,
    )).toThrow(expect.objectContaining({ messageCode: "SALES_PAYMENT_PRECISION_INVALID" }));
    expect(() => SalesReceivableCalculator.applyPayment(
      receivable("EUR", "100"), "1.001", timestamp,
    )).toThrow(expect.objectContaining({ messageCode: "SALES_PAYMENT_PRECISION_INVALID" }));
  });

  test("supports values beyond Number safe precision", () => {
    const result = SalesReceivableCalculator.applyPayment(
      receivable("XOF", "999999999999999999999999999999"),
      "123456789012345678901234567890",
      timestamp,
    ).receivable;
    expect(result.balanceDue).toBe("876543210987654321098765432109");
  });
});
