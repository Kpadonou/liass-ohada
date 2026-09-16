import { SalesCreditNoteService } from "@/lambda/domains/sales/invoices/sales-credit-note-service";
import { SalesCreditNoteIssueTransactionError, SalesCreditNoteRepository } from "@/lambda/domains/sales/invoices/sales-credit-note-repository";
import { SalesInvoiceService } from "@/lambda/domains/sales/invoices/sales-invoice-service";
import { SalesPaymentService } from "@/lambda/domains/sales/invoices/sales-payment-service";

jest.mock("@/lambda/domains/sales/invoices/sales-invoice-service", () => ({ SalesInvoiceService: { get: jest.fn() } }));
jest.mock("@/lambda/domains/sales/invoices/sales-payment-service", () => ({ SalesPaymentService: { loadCanonicalReceivableState: jest.fn() } }));
jest.mock("@/lambda/domains/sales/invoices/sales-credit-note-repository", () => {
  const actual = jest.requireActual("@/lambda/domains/sales/invoices/sales-credit-note-repository");
  return { ...actual, SalesCreditNoteRepository: {
    create: jest.fn(), update: jest.fn(), get: jest.fn(), list: jest.fn(),
    getSequence: jest.fn(), getIssueIdempotency: jest.fn(), issueAtomically: jest.fn(),
  } };
});

const timestamp = "2026-09-10T10:00:00.000Z";
const invoice = { id: "SINV-1", status: "ISSUED" as const, currency: "XOF",
  customerId: "SC-1", customerSnapshot: { name: "ABC SARL" },
  lines: [{ id: "SIL-1", position: 1, description: "Goods", quantity: "10",
    unitPrice: "1000", taxRate: "0", subtotal: "10000", taxAmount: "0", total: "10000",
    createdAt: timestamp, updatedAt: timestamp }], subtotal: "10000", taxTotal: "0", total: "10000",
  lineCount: 1, version: 2, createdAt: timestamp, updatedAt: timestamp,
  invoiceNumber: "00000001", issueDate: "2026-09-10", issuedAt: timestamp };
const line = { id: "SCL-1", originalInvoiceLineId: "SIL-1", position: 1,
  description: "Goods", quantity: "2", unitPrice: "1000", taxRate: "0",
  subtotal: "2000", taxAmount: "0", total: "2000", createdAt: timestamp, updatedAt: timestamp };
const draft = { id: "SCN-1", originalInvoiceId: "SINV-1", originalInvoiceNumber: "00000001",
  status: "DRAFT" as const, customerSnapshot: invoice.customerSnapshot, currency: "XOF", reason: "Return",
  lines: [line], subtotal: "2000", taxTotal: "0", total: "2000", lineCount: 1,
  version: 2, createdAt: timestamp, updatedAt: timestamp };
const receivable = { invoiceId: "SINV-1", currency: "XOF", invoiceAmount: "10000",
  amountPaid: "3000", creditedAmount: "0", balanceDue: "7000", status: "PARTIALLY_SETTLED" as const,
  paymentCount: 1, version: 1, createdAt: timestamp, updatedAt: timestamp };
const request = { expectedCreditNoteVersion: 2, expectedReceivableVersion: 1,
  clientRequestId: "243dc17a-6c2b-4e2d-87b8-2ad2ae9f12da", issueDate: "2026-09-10" };

describe("SalesCreditNoteService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "info").mockImplementation(() => undefined);
    jest.mocked(SalesInvoiceService.get).mockResolvedValue(invoice);
    jest.mocked(SalesCreditNoteRepository.get).mockResolvedValue(draft);
    jest.mocked(SalesCreditNoteRepository.getIssueIdempotency).mockResolvedValue(undefined);
    jest.mocked(SalesCreditNoteRepository.getSequence).mockResolvedValue({ exists: false, lastValue: "0" });
    jest.mocked(SalesPaymentService.loadCanonicalReceivableState).mockResolvedValue({ receivable, creditedLineQuantities: {} });
  });
  afterEach(() => jest.restoreAllMocks());

  test("creates an empty bounded draft from immutable Invoice snapshots", async () => {
    const result = await SalesCreditNoteService.create("org-123", "user-123", "SINV-1", { reason: "Return" });
    expect(result).toMatchObject({ status: "DRAFT", originalInvoiceId: "SINV-1",
      originalInvoiceNumber: "00000001", customerSnapshot: invoice.customerSnapshot,
      currency: "XOF", lines: [], total: "0", version: 1 });
    expect(SalesCreditNoteRepository.create).toHaveBeenCalledWith("org-123", result);
  });

  test("adds only a quantity and copies source-line commercial facts", async () => {
    jest.mocked(SalesCreditNoteRepository.get).mockResolvedValue({ ...draft, lines: [], lineCount: 0,
      subtotal: "0", total: "0", version: 1 });
    const result = await SalesCreditNoteService.addLine("org-123", "user-123", "SINV-1", "SCN-1",
      { expectedVersion: 1, originalInvoiceLineId: "SIL-1", quantity: "3" });
    expect(result.lines[0]).toMatchObject({ originalInvoiceLineId: "SIL-1", quantity: "3",
      description: "Goods", unitPrice: "1000", taxRate: "0", total: "3000" });
    expect(result).toMatchObject({ total: "3000", lineCount: 1, version: 2 });
  });

  test("issues once, updates generic Receivable, and preserves Invoice", async () => {
    const before = structuredClone(invoice);
    const result = await SalesCreditNoteService.issue("org-123", "user-123", "SINV-1", "SCN-1", request);
    expect(result.creditNote).toMatchObject({ status: "ISSUED", creditNoteNumber: "00000001", version: 3 });
    expect(result.receivable).toMatchObject({ amountPaid: "3000", creditedAmount: "2000",
      balanceDue: "5000", status: "PARTIALLY_SETTLED", paymentCount: 1, version: 2 });
    expect(SalesCreditNoteRepository.issueAtomically).toHaveBeenCalledWith(expect.objectContaining({
      orgId: "org-123", issuedByUserId: "user-123", originalExpectedCreditNoteVersion: 2,
      originalExpectedReceivableVersion: 1, creditedLineQuantities: { "SIL-1": "2" },
    }));
    expect(invoice).toEqual(before);
  });

  test("rejects cumulative over-credit and current balance over-credit", async () => {
    jest.mocked(SalesPaymentService.loadCanonicalReceivableState).mockResolvedValue({
      receivable, creditedLineQuantities: { "SIL-1": "9" },
    });
    await expect(SalesCreditNoteService.issue("org-123", "user-123", "SINV-1", "SCN-1", request))
      .rejects.toMatchObject({ messageCode: "SALES_CREDIT_NOTE_CUMULATIVE_QUANTITY_EXCEEDED" });
    jest.mocked(SalesPaymentService.loadCanonicalReceivableState).mockResolvedValue({
      receivable: { ...receivable, balanceDue: "1000", amountPaid: "9000" }, creditedLineQuantities: {},
    });
    await expect(SalesCreditNoteService.issue("org-123", "user-123", "SINV-1", "SCN-1", request))
      .rejects.toMatchObject({ messageCode: "SALES_CREDIT_NOTE_EXCEEDS_BALANCE" });
  });

  test("retries only sequence contention and does not silently retry stale Receivable", async () => {
    jest.mocked(SalesCreditNoteRepository.issueAtomically)
      .mockRejectedValueOnce(new SalesCreditNoteIssueTransactionError("SEQUENCE_CONTENTION"))
      .mockResolvedValueOnce(undefined);
    await expect(SalesCreditNoteService.issue("org-123", "user-123", "SINV-1", "SCN-1", request)).resolves.toBeDefined();
    expect(SalesCreditNoteRepository.issueAtomically).toHaveBeenCalledTimes(2);
    jest.mocked(SalesCreditNoteRepository.issueAtomically).mockReset()
      .mockRejectedValue(new SalesCreditNoteIssueTransactionError("RECEIVABLE_CONFLICT"));
    await expect(SalesCreditNoteService.issue("org-123", "user-123", "SINV-1", "SCN-1", request))
      .rejects.toMatchObject({ messageCode: "SALES_RECEIVABLE_VERSION_CONFLICT" });
    expect(SalesCreditNoteRepository.issueAtomically).toHaveBeenCalledTimes(1);
  });

  test("issued Credit Note is immutable through every draft mutation", async () => {
    jest.mocked(SalesCreditNoteRepository.get).mockResolvedValue({ ...draft, status: "ISSUED",
      creditNoteNumber: "00000001", issueDate: "2026-09-10", issuedAt: timestamp });
    await expect(SalesCreditNoteService.update("org-123", "user-123", "SINV-1", "SCN-1",
      { expectedVersion: 2, reason: "Other" })).rejects.toMatchObject({ messageCode: "SALES_CREDIT_NOTE_NOT_EDITABLE" });
    await expect(SalesCreditNoteService.removeLine("org-123", "user-123", "SINV-1", "SCN-1", "SCL-1", 2))
      .rejects.toMatchObject({ messageCode: "SALES_CREDIT_NOTE_NOT_EDITABLE" });
  });

  test("fails safely when an idempotency replay points to missing state", async () => {
    jest.mocked(SalesCreditNoteRepository.getIssueIdempotency).mockResolvedValue({
      PK: "ORG#org-123", SK: `SALES_CREDIT_NOTE_ISSUE_IDEMPOTENCY#${request.clientRequestId}`,
      entityType: "SALES_CREDIT_NOTE_ISSUE_IDEMPOTENCY", orgId: "org-123",
      clientRequestId: request.clientRequestId, invoiceId: "SINV-1", creditNoteId: "SCN-1",
      issueDate: request.issueDate, originalExpectedCreditNoteVersion: 2,
      originalExpectedReceivableVersion: 1, creditNoteNumber: "00000001", createdAt: timestamp,
    });
    jest.mocked(SalesCreditNoteRepository.get).mockResolvedValue(undefined);

    await expect(SalesCreditNoteService.issue("org-123", "user-123", "SINV-1", "SCN-1", request))
      .rejects.toMatchObject({ messageCode: "SALES_CREDIT_NOTE_IDEMPOTENCY_INTEGRITY_ERROR" });
    expect(SalesCreditNoteRepository.issueAtomically).not.toHaveBeenCalled();
  });
});
