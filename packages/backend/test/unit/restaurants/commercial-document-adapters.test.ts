import {
  RestaurantCreditNoteSchema,
  RestaurantReceiptSummarySchema,
  RestaurantRefundSchema,
  adaptCreditNoteToInvoice,
  adaptReceiptSummaryToInvoice,
  adaptRefundToInvoice,
  invoiceIdFromLegacyAliases,
  adaptPublicationToInvoice,
  adaptReceiptViewToInvoice,
} from "@liass-ohada/shared/restaurants";

const id = "11111111-1111-4111-8111-111111111111";
const id2 = "22222222-2222-4222-8222-222222222222";
const now = "2026-11-02T10:00:00.000Z";

function summary() {
  return RestaurantReceiptSummarySchema.parse({
    receiptId: id,
    guestSessionId: id2,
    scopeKind: "GUEST_SESSION",
    documentKind: "OPERATIONAL_RECEIPT",
    schemaVersion: 1,
    outletName: "Outlet",
    restaurantName: "Restaurant",
    tableName: "T1",
    openedAt: now,
    closedAt: now,
    currency: "XOF",
    dueMinor: 900,
    paidMinor: 900,
    paidByMethodMinor: { CASH: 900, CARD: 0, MOBILE_MONEY: 0 },
    partCount: 2,
    commercialPartCount: 1,
    settlementPartCount: 1,
    lineCount: 1,
    paymentCount: 1,
    digest: "a".repeat(64),
    issuedAt: now,
  });
}

function credit() {
  return RestaurantCreditNoteSchema.parse({
    creditNoteId: id,
    creditNoteReference: "AV-20261102-ABCDEF12",
    orgId: "org-1",
    outletId: id2,
    guestSessionId: id2,
    finalBillId: id,
    sourceReceiptDigest: "b".repeat(64),
    currency: "XOF",
    amountMinor: 900,
    reason: "Correction",
    status: "VALIDATED",
    validatedAt: now,
    validatedByUserId: "user-1",
    schemaVersion: 1,
    clientRequestId: id2,
    intentFingerprint: "c".repeat(64),
    entityType: "RESTAURANT_CREDIT_NOTE",
    lineCount: 1,
  });
}

function refund() {
  return RestaurantRefundSchema.parse({
    refundId: id,
    refundReference: "REF-20261102-ABCDEF12",
    creditNoteId: id2,
    guestSessionId: id2,
    finalBillId: id,
    orgId: "org-1",
    outletId: id2,
    amountMinor: 100,
    currency: "XOF",
    method: "CASH",
    status: "CONFIRMED",
    refundedAt: now,
    refundedByUserId: "user-1",
    businessDayId: id,
    cashSessionId: id2,
    schemaVersion: 1,
    clientRequestId: id,
    intentFingerprint: "d".repeat(64),
    entityType: "RESTAURANT_REFUND",
  });
}

describe("Restaurants commercial document adapters", () => {
  it("links historical Invoice, CreditNote and Refund without rewriting any source fact", () => {
    const legacyInvoice = summary();
    const legacyCredit = {
      ...credit(),
      sourceReceiptDigest: legacyInvoice.digest,
    };
    const legacyRefund = {
      ...refund(),
      creditNoteId: legacyCredit.creditNoteId,
    };
    const before = JSON.stringify([legacyInvoice, legacyCredit, legacyRefund]);
    const invoice = adaptReceiptSummaryToInvoice(legacyInvoice);
    const cn = adaptCreditNoteToInvoice(legacyCredit);
    const rf = adaptRefundToInvoice(legacyRefund, cn.invoiceId);
    expect(cn.invoiceId).toBe(invoice.invoiceId);
    expect(cn.sourceInvoiceDigest).toBe(invoice.digest);
    expect(rf.invoiceId).toBe(invoice.invoiceId);
    expect(rf.creditNoteId).toBe(cn.creditNoteId);
    expect(rf).not.toHaveProperty("paymentId");
    expect(JSON.stringify([legacyInvoice, legacyCredit, legacyRefund])).toBe(
      before,
    );
  });
  it("keeps BUILDING identity on retry without fabricating a FINAL Invoice", () => {
    const building = {
      data: {
        state: "BUILDING" as const,
        receiptId: id,
        version: 1,
        partCount: 0,
      },
    };
    const first = adaptPublicationToInvoice(building);
    const retry = adaptPublicationToInvoice({
      data: { ...building.data, version: 2 },
    });
    expect(first.data).toMatchObject({ state: "BUILDING", invoiceId: id });
    expect(first.data).not.toHaveProperty("invoice");
    expect(retry.data).toMatchObject({ invoiceId: id });
    expect(
      adaptPublicationToInvoice({
        data: { state: "FINAL", receipt: summary() },
      }).data,
    ).toMatchObject({ state: "FINAL", invoice: { invoiceId: id } });
  });

  it("preserves legacy proof payload bytes during canonical adaptation", () => {
    const legacy = { data: summary(), parts: [] };
    const before = JSON.stringify(legacy);
    const view = adaptReceiptViewToInvoice(legacy);
    expect(JSON.stringify(legacy)).toBe(before);
    expect(view.data.digest).toBe(legacy.data.digest);
    expect(view.parts).toEqual(legacy.parts);
  });

  it("rejects contradictory receipt and digest aliases", () => {
    expect(() =>
      adaptReceiptSummaryToInvoice({
        ...summary(),
        invoiceId: id2,
      } as ReturnType<typeof summary>),
    ).toThrow();
    expect(() =>
      adaptCreditNoteToInvoice({
        ...credit(),
        sourceInvoiceDigest: "e".repeat(64),
      } as ReturnType<typeof credit>),
    ).toThrow();
  });

  it("resolves split settlement identities without adding fields to Payment facts", () => {
    const payments = [
      { paymentId: id, guestSessionId: id2 },
      { paymentId: id2, guestSessionId: id2 },
    ];
    const before = JSON.stringify(payments);
    const openSession = { guestSessionId: id2 };
    expect("finalBillId" in openSession).toBe(false);
    const closedSession = { ...openSession, finalBillId: id };
    expect(
      payments.map(() => invoiceIdFromLegacyAliases(closedSession)),
    ).toEqual([id, id]);
    expect(JSON.stringify(payments)).toBe(before);
  });
  it("maps legacy receipt identity to canonical invoice identity without changing digest", () => {
    const invoice = adaptReceiptSummaryToInvoice(summary());
    expect(invoice.invoiceId).toBe(id);
    expect(invoice.documentKind).toBe("INVOICE");
    expect(invoice.digest).toBe("a".repeat(64));
  });

  it("maps CreditNote and Refund finalBillId to invoiceId", () => {
    const cn = adaptCreditNoteToInvoice(credit());
    const rf = adaptRefundToInvoice(refund());
    expect(cn.invoiceId).toBe(id);
    expect(cn.sourceInvoiceDigest).toBe("b".repeat(64));
    expect(rf.invoiceId).toBe(id);
  });

  it("rejects contradictory aliases", () => {
    expect(() =>
      invoiceIdFromLegacyAliases({ invoiceId: id, finalBillId: id2 }),
    ).toThrow("Contradictory invoice aliases");
  });

  it("accepts the same identity from legacy receiptId/finalBillId aliases", () => {
    expect(invoiceIdFromLegacyAliases({ receiptId: id, finalBillId: id })).toBe(
      id,
    );
  });
});
