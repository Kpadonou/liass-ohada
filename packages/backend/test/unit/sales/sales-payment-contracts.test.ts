import {
  RecordSalesPaymentRequestSchema,
  SalesInvoiceReceivableSchema,
  SalesPaymentListResponseSchema,
  SalesPaymentMethodSchema,
  SalesPaymentSchema,
} from "@liass-ohada/shared/sales";

const timestamp = "2026-09-10T10:00:00.000Z";

describe("SALES Payment shared contracts", () => {
  test.each([
    ["OPEN", "0", "0", "100", 0],
    ["PARTIALLY_SETTLED", "30", "0", "70", 1],
    ["PARTIALLY_SETTLED", "20", "30", "50", 1],
    ["SETTLED", "100", "0", "0", 2],
    ["SETTLED", "0", "0", "0", 0],
  ])("accepts canonical %s Receivable state", (status, amountPaid, creditedAmount, balanceDue, paymentCount) => {
    expect(SalesInvoiceReceivableSchema.safeParse({
      invoiceId: "SINV-1",
      currency: "XOF",
      invoiceAmount: status === "SETTLED" && amountPaid === "0" && creditedAmount === "0" ? "0" : "100",
      amountPaid,
      creditedAmount,
      balanceDue,
      status,
      paymentCount,
      version: paymentCount,
      updatedAt: timestamp,
    }).success).toBe(true);
  });

  test("rejects inconsistent status, sums, negative-like values, and persistence keys", () => {
    const base = {
      invoiceId: "SINV-1", currency: "EUR", invoiceAmount: "100",
      amountPaid: "20", creditedAmount: "0", balanceDue: "80", status: "PARTIALLY_SETTLED",
      paymentCount: 1, version: 1, updatedAt: timestamp,
    };
    for (const invalid of [
      { ...base, status: "SETTLED" },
      { ...base, balanceDue: "81" },
      { ...base, amountPaid: "-1" },
      { ...base, PK: "ORG#org-1" },
    ]) expect(SalesInvoiceReceivableSchema.safeParse(invalid).success).toBe(false);
  });

  test("record request requires only strict client-owned fields", () => {
    const request = {
      expectedVersion: 0,
      clientRequestId: "243dc17a-6c2b-4e2d-87b8-2ad2ae9f12da",
      amount: "20.25",
      paymentDate: "2026-09-10",
      method: "BANK_TRANSFER",
      reference: "VIR-42",
    };
    expect(RecordSalesPaymentRequestSchema.parse(request)).toEqual(request);
    for (const field of ["expectedVersion", "clientRequestId", "amount", "paymentDate", "method"] as const) {
      const invalid = { ...request } as Record<string, unknown>;
      delete invalid[field];
      expect(RecordSalesPaymentRequestSchema.safeParse(invalid).success).toBe(false);
    }
    for (const field of ["currency", "invoiceId", "orgId", "amountPaid", "balanceDue", "status", "recordedByUserId"]) {
      expect(RecordSalesPaymentRequestSchema.safeParse({ ...request, [field]: "forbidden" }).success).toBe(false);
    }
    for (const amount of ["0", "-1", "+1", " 1", "1,5", "1e2"]) {
      expect(RecordSalesPaymentRequestSchema.safeParse({ ...request, amount }).success).toBe(false);
    }
    expect(RecordSalesPaymentRequestSchema.safeParse({ ...request, paymentDate: "2026-02-30" }).success).toBe(false);
  });

  test.each(["CASH", "BANK_TRANSFER", "CARD", "MOBILE_MONEY", "CHEQUE", "OTHER"])(
    "accepts generic method %s",
    (method) => expect(SalesPaymentMethodSchema.parse(method)).toBe(method),
  );

  test("Payment/list DTOs expose no persistence or actor attributes", () => {
    const payment = {
      id: "SPAY-1", invoiceId: "SINV-1", amount: "10", currency: "XOF",
      paymentDate: "2026-09-10", method: "CASH", createdAt: timestamp,
    };
    expect(SalesPaymentListResponseSchema.parse({ items: [payment] })).toEqual({ items: [payment] });
    for (const field of ["PK", "SK", "entityType", "recordedByUserId"]) {
      expect(SalesPaymentSchema.safeParse({ ...payment, [field]: "forbidden" }).success).toBe(false);
    }
  });
});
