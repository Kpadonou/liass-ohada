import { SalesPaymentService } from "@/lambda/domains/sales/invoices/sales-payment-service";
import {
  SalesPaymentRepository,
  SalesPaymentTransactionError,
} from "@/lambda/domains/sales/invoices/sales-payment-repository";
import { SalesInvoiceService } from "@/lambda/domains/sales/invoices/sales-invoice-service";

jest.mock("@/lambda/domains/sales/invoices/sales-invoice-service", () => ({
  SalesInvoiceService: { get: jest.fn() },
}));
jest.mock("@/lambda/domains/sales/invoices/sales-payment-repository", () => {
  const actual = jest.requireActual("@/lambda/domains/sales/invoices/sales-payment-repository");
  return {
    ...actual,
    SalesPaymentRepository: {
      getReceivable: jest.fn(), getReceivableState: jest.fn(), getPayment: jest.fn(), getIdempotency: jest.fn(),
      list: jest.fn(), recordAtomically: jest.fn(),
    },
  };
});

const timestamp = "2026-09-10T10:00:00.000Z";
const issued = {
  id: "SINV-1", status: "ISSUED" as const, currency: "XOF",
  lines: [{
    id: "SIL-1", position: 1, description: "Service", quantity: "1",
    unitPrice: "100000", taxRate: "0", subtotal: "100000", taxAmount: "0",
    total: "100000", createdAt: timestamp, updatedAt: timestamp,
  }],
  subtotal: "100000", taxTotal: "0", total: "100000", lineCount: 1,
  version: 2, createdAt: timestamp, updatedAt: timestamp,
  invoiceNumber: "00000001", issueDate: "2026-09-10", issuedAt: timestamp,
};
const request = {
  expectedVersion: 0,
  clientRequestId: "243dc17a-6c2b-4e2d-87b8-2ad2ae9f12da",
  amount: "30000",
  paymentDate: "2026-09-10",
  method: "CASH" as const,
};

describe("SalesPaymentService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "info").mockImplementation(() => undefined);
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    jest.mocked(SalesInvoiceService.get).mockResolvedValue(issued);
    jest.mocked(SalesPaymentRepository.getReceivable).mockResolvedValue(undefined);
    jest.mocked(SalesPaymentRepository.getReceivableState).mockResolvedValue(undefined);
    jest.mocked(SalesPaymentRepository.getIdempotency).mockResolvedValue(undefined);
    jest.mocked(SalesPaymentRepository.recordAtomically).mockResolvedValue(undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  test("returns a read-only synthetic version-0 Receivable before first Payment", async () => {
    await expect(SalesPaymentService.getReceivable("org-123", "SINV-1")).resolves.toMatchObject({
      invoiceId: "SINV-1", invoiceAmount: "100000", amountPaid: "0",
      creditedAmount: "0", balanceDue: "100000", status: "OPEN", paymentCount: 0, version: 0,
    });
    expect(SalesPaymentRepository.recordAtomically).not.toHaveBeenCalled();
  });

  test("zero-total issued Invoice is synthetically SETTLED and rejects a Payment", async () => {
    jest.mocked(SalesInvoiceService.get).mockResolvedValue({
      ...issued,
      lines: [{ ...issued.lines[0], unitPrice: "0", subtotal: "0", total: "0" }],
      subtotal: "0", total: "0",
    });
    await expect(SalesPaymentService.getReceivable("org-123", "SINV-1"))
      .resolves.toMatchObject({ invoiceAmount: "0", creditedAmount: "0", status: "SETTLED", version: 0 });
    await expect(SalesPaymentService.record("org-123", "user-123", "SINV-1", request))
      .rejects.toMatchObject({ messageCode: "SALES_INVOICE_ALREADY_SETTLED" });
  });

  test("Draft Invoice has no operational Receivable or Payment history", async () => {
    jest.mocked(SalesInvoiceService.get).mockResolvedValue({
      ...issued, status: "DRAFT", lines: [], lineCount: 0,
      subtotal: "0", total: "0", version: 1,
    } as any);
    await expect(SalesPaymentService.getReceivable("org-123", "SINV-1"))
      .rejects.toMatchObject({ messageCode: "SALES_RECEIVABLE_REQUIRES_ISSUED" });
    await expect(SalesPaymentService.listPayments("org-123", "SINV-1", {}))
      .rejects.toMatchObject({ messageCode: "SALES_RECEIVABLE_REQUIRES_ISSUED" });
  });

  test("first Payment materializes version 1 without mutating Invoice", async () => {
    const before = structuredClone(issued);
    const result = await SalesPaymentService.record("org-123", "user-123", "SINV-1", request);
    expect(result.payment).toMatchObject({
      invoiceId: "SINV-1", amount: "30000", currency: "XOF", method: "CASH",
    });
    expect(result.receivable).toMatchObject({
      amountPaid: "30000", creditedAmount: "0", balanceDue: "70000", status: "PARTIALLY_SETTLED",
      paymentCount: 1, version: 1,
    });
    expect(SalesPaymentRepository.recordAtomically).toHaveBeenCalledWith(expect.objectContaining({
      orgId: "org-123", recordedByUserId: "user-123",
      previousReceivableVersion: 0, originalExpectedVersion: 0,
    }));
    expect(issued).toEqual(before);
    expect(issued.status).toBe("ISSUED");
    expect(issued.version).toBe(2);
  });

  test("enforces Receivable version and overpayment", async () => {
    await expect(SalesPaymentService.record("org-123", "user-123", "SINV-1", {
      ...request, expectedVersion: 1,
    })).rejects.toMatchObject({ messageCode: "SALES_RECEIVABLE_VERSION_CONFLICT" });
    await expect(SalesPaymentService.record("org-123", "user-123", "SINV-1", {
      ...request, amount: "100001",
    })).rejects.toMatchObject({ messageCode: "SALES_PAYMENT_EXCEEDS_BALANCE" });
  });

  test("rejects fractional XOF without rounding", async () => {
    await expect(SalesPaymentService.record("org-123", "user-123", "SINV-1", {
      ...request, amount: "1.5",
    })).rejects.toMatchObject({ messageCode: "SALES_PAYMENT_PRECISION_INVALID" });
  });

  test("exact replay after settlement returns original Payment and current Receivable", async () => {
    const payment = {
      id: "SPAY-1", invoiceId: "SINV-1", amount: "100000", currency: "XOF",
      paymentDate: request.paymentDate, method: request.method, createdAt: timestamp,
    };
    const paid = {
      invoiceId: "SINV-1", currency: "XOF", invoiceAmount: "100000",
      amountPaid: "100000", creditedAmount: "0", balanceDue: "0", status: "SETTLED" as const,
      paymentCount: 1, version: 1, createdAt: timestamp, updatedAt: timestamp,
    };
    jest.mocked(SalesPaymentRepository.getIdempotency).mockResolvedValue({
      PK: "ORG#org-123", SK: `SALES_PAYMENT_IDEMPOTENCY#${request.clientRequestId}`,
      entityType: "SALES_PAYMENT_IDEMPOTENCY", orgId: "org-123",
      clientRequestId: request.clientRequestId, invoiceId: "SINV-1", paymentId: "SPAY-1",
      originalExpectedVersion: 0, amount: "100000", paymentDate: request.paymentDate,
      method: request.method, createdAt: timestamp,
    });
    jest.mocked(SalesPaymentRepository.getPayment).mockResolvedValue(payment);
    jest.mocked(SalesPaymentRepository.getReceivable).mockResolvedValue(paid);
    jest.mocked(SalesPaymentRepository.getReceivableState).mockResolvedValue({ receivable: paid, creditedLineQuantities: {} });
    await expect(SalesPaymentService.record("org-123", "user-123", "SINV-1", {
      ...request, amount: "100000",
    })).resolves.toEqual({ payment, receivable: paid });
    expect(SalesPaymentRepository.recordAtomically).not.toHaveBeenCalled();
  });

  test("same-request concurrency converges on the winning Payment", async () => {
    const payment = {
      id: "SPAY-winner", invoiceId: "SINV-1", amount: "30000", currency: "XOF",
      paymentDate: request.paymentDate, method: request.method, createdAt: timestamp,
    };
    const receivable = {
      invoiceId: "SINV-1", currency: "XOF", invoiceAmount: "100000",
      amountPaid: "30000", creditedAmount: "0", balanceDue: "70000", status: "PARTIALLY_SETTLED" as const,
      paymentCount: 1, version: 1, createdAt: timestamp, updatedAt: timestamp,
    };
    const winner = {
      PK: "ORG#org-123", SK: `SALES_PAYMENT_IDEMPOTENCY#${request.clientRequestId}`,
      entityType: "SALES_PAYMENT_IDEMPOTENCY" as const, orgId: "org-123",
      clientRequestId: request.clientRequestId, invoiceId: "SINV-1",
      paymentId: payment.id, originalExpectedVersion: 0, amount: request.amount,
      paymentDate: request.paymentDate, method: request.method, createdAt: timestamp,
    };
    jest.mocked(SalesPaymentRepository.getIdempotency)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(winner);
    jest.mocked(SalesPaymentRepository.recordAtomically).mockRejectedValue(
      new SalesPaymentTransactionError("IDEMPOTENCY_CONFLICT"),
    );
    jest.mocked(SalesPaymentRepository.getReceivableState)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ receivable, creditedLineQuantities: {} });
    jest.mocked(SalesPaymentRepository.getPayment).mockResolvedValue(payment);

    await expect(SalesPaymentService.record("org-123", "user-123", "SINV-1", request))
      .resolves.toEqual({ payment, receivable });
    expect(SalesPaymentRepository.recordAtomically).toHaveBeenCalledTimes(1);
  });

  test("reused idempotency key and distinct concurrent payment fail without retrying money", async () => {
    jest.mocked(SalesPaymentRepository.getIdempotency).mockResolvedValueOnce({
      PK: "ORG#org-123", SK: `SALES_PAYMENT_IDEMPOTENCY#${request.clientRequestId}`,
      entityType: "SALES_PAYMENT_IDEMPOTENCY", orgId: "org-123",
      clientRequestId: request.clientRequestId, invoiceId: "SINV-other", paymentId: "SPAY-1",
      originalExpectedVersion: 0, amount: "30000", paymentDate: request.paymentDate,
      method: request.method, createdAt: timestamp,
    });
    await expect(SalesPaymentService.record("org-123", "user-123", "SINV-1", request))
      .rejects.toMatchObject({ messageCode: "SALES_PAYMENT_IDEMPOTENCY_KEY_REUSED" });

    jest.mocked(SalesPaymentRepository.getIdempotency)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);
    jest.mocked(SalesPaymentRepository.recordAtomically).mockRejectedValue(
      new SalesPaymentTransactionError("RECEIVABLE_CONFLICT"),
    );
    jest.mocked(SalesPaymentRepository.getReceivable).mockResolvedValue({
      invoiceId: "SINV-1", currency: "XOF", invoiceAmount: "100000",
      amountPaid: "10000", creditedAmount: "0", balanceDue: "90000", status: "PARTIALLY_SETTLED",
      paymentCount: 1, version: 1, createdAt: timestamp, updatedAt: timestamp,
    });
    await expect(SalesPaymentService.record("org-123", "user-123", "SINV-1", request))
      .rejects.toMatchObject({ messageCode: "SALES_RECEIVABLE_VERSION_CONFLICT" });
  });
});
