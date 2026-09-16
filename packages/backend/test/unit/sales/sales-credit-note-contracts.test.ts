import {
  AddSalesCreditNoteLineRequestSchema,
  CreateSalesCreditNoteRequestSchema,
  IssueSalesCreditNoteRequestSchema,
  SalesCreditNoteSchema,
  SalesCreditNoteStatusSchema,
  SalesReceivableStatusSchema,
  UpdateSalesCreditNoteLineRequestSchema,
} from "@liass-ohada/shared/sales";

const timestamp = "2026-09-10T10:00:00.000Z";
const draft = {
  id: "SCN-1", originalInvoiceId: "SINV-1", originalInvoiceNumber: "00000001",
  status: "DRAFT" as const, currency: "XOF", reason: "Returned goods", lines: [],
  subtotal: "0", taxTotal: "0", total: "0", lineCount: 0, version: 1,
  createdAt: timestamp, updatedAt: timestamp,
};

describe("SALES Credit Note shared contracts", () => {
  test("uses exact lifecycle and settlement enums", () => {
    expect(SalesCreditNoteStatusSchema.options).toEqual(["DRAFT", "ISSUED"]);
    expect(SalesReceivableStatusSchema.options).toEqual(["OPEN", "PARTIALLY_SETTLED", "SETTLED"]);
  });

  test("enforces strict draft and issued invariants", () => {
    expect(SalesCreditNoteSchema.parse(draft)).toEqual(draft);
    expect(SalesCreditNoteSchema.safeParse({ ...draft, creditNoteNumber: "00000001" }).success).toBe(false);
    const line = { id: "SCL-1", originalInvoiceLineId: "SIL-1", position: 1,
      description: "Service", quantity: "1", unitPrice: "100", taxRate: "0",
      subtotal: "100", taxAmount: "0", total: "100", createdAt: timestamp, updatedAt: timestamp };
    expect(SalesCreditNoteSchema.safeParse({ ...draft, status: "ISSUED", lines: [line], lineCount: 1,
      subtotal: "100", total: "100", creditNoteNumber: "00000001", issueDate: "2026-09-10", issuedAt: timestamp }).success).toBe(true);
    expect(SalesCreditNoteSchema.safeParse({ ...draft, status: "ISSUED" }).success).toBe(false);
  });

  test("requests expose only client-owned fields", () => {
    expect(CreateSalesCreditNoteRequestSchema.parse({})).toEqual({});
    expect(AddSalesCreditNoteLineRequestSchema.parse({ expectedVersion: 1, originalInvoiceLineId: "SIL-1", quantity: "1.25" }))
      .toEqual({ expectedVersion: 1, originalInvoiceLineId: "SIL-1", quantity: "1.25" });
    expect(UpdateSalesCreditNoteLineRequestSchema.safeParse({ expectedVersion: 1, quantity: "1", unitPrice: "1" }).success).toBe(false);
    expect(CreateSalesCreditNoteRequestSchema.safeParse({ currency: "XOF" }).success).toBe(false);
    expect(IssueSalesCreditNoteRequestSchema.safeParse({ expectedCreditNoteVersion: 2,
      expectedReceivableVersion: 0, clientRequestId: "243dc17a-6c2b-4e2d-87b8-2ad2ae9f12da",
      issueDate: "2026-09-10", issuedByUserId: "attacker" }).success).toBe(false);
  });

  test.each(["0", "-1", "+1", " 1", "1,5", "1e2"])("rejects invalid quantity %s", (quantity) => {
    expect(AddSalesCreditNoteLineRequestSchema.safeParse({ expectedVersion: 1,
      originalInvoiceLineId: "SIL-1", quantity }).success).toBe(false);
  });
});
