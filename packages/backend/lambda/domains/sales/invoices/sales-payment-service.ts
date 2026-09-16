import { randomUUID } from "crypto";
import {
  ListSalesPaymentsRequest,
  ListSalesPaymentsRequestSchema,
  RecordSalesPaymentRequest,
  RecordSalesPaymentRequestSchema,
  RecordSalesPaymentResponse,
  RecordSalesPaymentResponseSchema,
  SalesInvoiceReceivable,
  SalesPayment,
  SalesPaymentListResponse,
  SalesPaymentListResponseSchema,
  SalesPaymentSchema,
} from "@liass-ohada/shared/sales";
import { z } from "zod";
import { AppError } from "@/lambda/shared/app-error";
import { SalesInvoiceService } from "./sales-invoice-service";
import {
  SalesPaymentIdempotencyRecord,
  SalesPaymentRepository,
  SalesPaymentTransactionError,
} from "./sales-payment-repository";
import { SalesReceivableCalculator } from "./sales-receivable-calculator";

const OrganizationIdSchema = z.string().min(1);
const EntityIdSchema = z.string().trim().min(1).max(200);

const normalizeDecimal = (value: string): string => {
  const [whole, fraction = ""] = value.split(".");
  const normalizedFraction = fraction.replace(/0+$/, "");
  return normalizedFraction ? `${whole}.${normalizedFraction}` : whole;
};

const audit = (input: {
  action: "SALES_PAYMENT_RECORDED" | "SALES_PAYMENT_REPLAYED";
  amount: string;
  currency: string;
  invoiceId: string;
  orgId: string;
  paymentCount: number;
  paymentId: string;
  paymentMethod: string;
  resultingStatus: string;
  resultingVersion: number;
}) => console.info("[SALES_PAYMENT_AUDIT]", input);

export class SalesPaymentService {
  static async getReceivable(
    orgId: string,
    invoiceId: string,
  ): Promise<SalesInvoiceReceivable> {
    const tenantId = OrganizationIdSchema.parse(orgId);
    const id = EntityIdSchema.parse(invoiceId);
    const invoice = await SalesInvoiceService.get(tenantId, id);
    if (invoice.status !== "ISSUED") {
      throw new AppError(409, "SALES_RECEIVABLE_REQUIRES_ISSUED");
    }
    return this.loadCanonicalReceivable(tenantId, invoice);
  }

  static async listPayments(
    orgId: string,
    invoiceId: string,
    input: ListSalesPaymentsRequest,
  ): Promise<SalesPaymentListResponse> {
    const tenantId = OrganizationIdSchema.parse(orgId);
    const id = EntityIdSchema.parse(invoiceId);
    const request = ListSalesPaymentsRequestSchema.parse(input);
    const invoice = await SalesInvoiceService.get(tenantId, id);
    if (invoice.status !== "ISSUED") {
      throw new AppError(409, "SALES_RECEIVABLE_REQUIRES_ISSUED");
    }
    return SalesPaymentListResponseSchema.parse(
      await SalesPaymentRepository.list(tenantId, id, request),
    );
  }

  static async record(
    orgId: string,
    actorUserId: string,
    invoiceId: string,
    input: RecordSalesPaymentRequest,
  ): Promise<RecordSalesPaymentResponse> {
    const tenantId = OrganizationIdSchema.parse(orgId);
    const userId = EntityIdSchema.parse(actorUserId);
    const id = EntityIdSchema.parse(invoiceId);
    const request = RecordSalesPaymentRequestSchema.parse(input);

    const existing = await this.loadIdempotency(
      tenantId,
      request.clientRequestId,
    );
    if (existing) return this.resolveReplay(tenantId, id, request, existing);

    const invoice = await SalesInvoiceService.get(tenantId, id);
    if (invoice.status !== "ISSUED") {
      throw new AppError(409, "SALES_RECEIVABLE_REQUIRES_ISSUED");
    }
    const currentState = await this.loadCanonicalReceivableState(tenantId, invoice);
    const current = currentState.receivable;
    if (current.balanceDue === "0") {
      throw new AppError(409, "SALES_INVOICE_ALREADY_SETTLED");
    }
    if (current.version !== request.expectedVersion) {
      throw new AppError(409, "SALES_RECEIVABLE_VERSION_CONFLICT");
    }

    const now = new Date().toISOString();
    const calculated = SalesReceivableCalculator.applyPayment(
      current,
      request.amount,
      now,
    );
    const payment = SalesPaymentSchema.parse({
      id: `SPAY-${Date.now().toString().padStart(13, "0")}-${randomUUID()}`,
      invoiceId: id,
      amount: calculated.amount,
      currency: invoice.currency,
      paymentDate: request.paymentDate,
      method: request.method,
      reference: request.reference,
      createdAt: now,
    });

    try {
      await SalesPaymentRepository.recordAtomically({
        orgId: tenantId,
        payment,
        receivable: calculated.receivable,
        recordedByUserId: userId,
        clientRequestId: request.clientRequestId,
        originalExpectedVersion: request.expectedVersion,
        previousReceivableVersion: current.version,
        creditedLineQuantities: currentState.creditedLineQuantities,
      });
    } catch (error) {
      if (!(error instanceof SalesPaymentTransactionError)) throw error;
      const winner = await this.loadIdempotency(
        tenantId,
        request.clientRequestId,
      );
      if (winner) return this.resolveReplay(tenantId, id, request, winner);

      const authoritative = await SalesPaymentRepository.getReceivable(tenantId, id);
      if ((authoritative?.version ?? 0) !== request.expectedVersion) {
        throw new AppError(409, "SALES_RECEIVABLE_VERSION_CONFLICT");
      }
      console.error("[SALES_RECEIVABLE_INTEGRITY]", {
        event: "PAYMENT_TRANSACTION_FAILURE",
        failure: error.failure,
        invoiceId: id,
        orgId: tenantId,
      });
      throw new AppError(409, "SALES_PAYMENT_CONCURRENCY_CONFLICT");
    }

    audit({
      action: "SALES_PAYMENT_RECORDED",
      amount: payment.amount,
      currency: payment.currency,
      invoiceId: id,
      orgId: tenantId,
      paymentCount: calculated.receivable.paymentCount,
      paymentId: payment.id,
      paymentMethod: payment.method,
      resultingStatus: calculated.receivable.status,
      resultingVersion: calculated.receivable.version,
    });
    return RecordSalesPaymentResponseSchema.parse({
      payment,
      receivable: calculated.receivable,
    });
  }

  private static async loadCanonicalReceivable(
    orgId: string,
    invoice: Awaited<ReturnType<typeof SalesInvoiceService.get>>,
  ): Promise<SalesInvoiceReceivable> {
    return (await this.loadCanonicalReceivableState(orgId, invoice)).receivable;
  }

  static async loadCanonicalReceivableState(
    orgId: string,
    invoice: Awaited<ReturnType<typeof SalesInvoiceService.get>>,
  ): Promise<import("./sales-payment-repository").SalesReceivableState> {
    try {
      const persisted = await SalesPaymentRepository.getReceivableState(orgId, invoice.id);
      if (!persisted) {
        return { receivable: SalesReceivableCalculator.synthetic({
          invoiceId: invoice.id,
          currency: invoice.currency,
          invoiceAmount: invoice.total,
          timestamp: invoice.updatedAt,
        }), creditedLineQuantities: {} };
      }
      const receivable = persisted.receivable;
      if (
        receivable.invoiceId !== invoice.id ||
        receivable.currency !== invoice.currency ||
        normalizeDecimal(receivable.invoiceAmount) !== normalizeDecimal(invoice.total)
      ) {
        throw new Error("Receivable Invoice snapshot mismatch");
      }
      return persisted;
    } catch (error) {
      console.error("[SALES_RECEIVABLE_INTEGRITY]", {
        event: "SALES_RECEIVABLE_INTEGRITY_ERROR",
        invoiceId: invoice.id,
        orgId,
        reason: error instanceof Error ? error.name : "UNKNOWN",
      });
      throw new AppError(500, "SALES_RECEIVABLE_INTEGRITY_ERROR");
    }
  }

  private static async resolveReplay(
    orgId: string,
    invoiceId: string,
    request: RecordSalesPaymentRequest,
    record: SalesPaymentIdempotencyRecord,
  ): Promise<RecordSalesPaymentResponse> {
    if (
      record.invoiceId !== invoiceId ||
      record.originalExpectedVersion !== request.expectedVersion ||
      normalizeDecimal(record.amount) !== normalizeDecimal(request.amount) ||
      record.paymentDate !== request.paymentDate ||
      record.method !== request.method ||
      record.reference !== request.reference
    ) {
      throw new AppError(409, "SALES_PAYMENT_IDEMPOTENCY_KEY_REUSED");
    }
    const invoice = await SalesInvoiceService.get(orgId, invoiceId);
    if (invoice.status !== "ISSUED") {
      throw new AppError(500, "SALES_PAYMENT_IDEMPOTENCY_INTEGRITY_ERROR");
    }
    let payment: SalesPayment | undefined;
    let receivable: SalesInvoiceReceivable;
    try {
      [payment, receivable] = await Promise.all([
        SalesPaymentRepository.getPayment(orgId, invoiceId, record.paymentId),
        this.loadCanonicalReceivable(orgId, invoice),
      ]);
    } catch (error) {
      if (error instanceof AppError) throw error;
      console.error("[SALES_RECEIVABLE_INTEGRITY]", {
        event: "IDEMPOTENCY_RESULT_READ_FAILED",
        invoiceId,
        orgId,
        paymentId: record.paymentId,
        reason: error instanceof Error ? error.name : "UNKNOWN",
      });
      throw new AppError(500, "SALES_PAYMENT_IDEMPOTENCY_INTEGRITY_ERROR");
    }
    if (!payment || normalizeDecimal(payment.amount) !== normalizeDecimal(record.amount)) {
      console.error("[SALES_RECEIVABLE_INTEGRITY]", {
        event: "IDEMPOTENCY_RECORD_MISMATCH",
        invoiceId,
        orgId,
        paymentId: record.paymentId,
      });
      throw new AppError(500, "SALES_PAYMENT_IDEMPOTENCY_INTEGRITY_ERROR");
    }
    audit({
      action: "SALES_PAYMENT_REPLAYED",
      amount: payment.amount,
      currency: payment.currency,
      invoiceId,
      orgId,
      paymentCount: receivable.paymentCount,
      paymentId: payment.id,
      paymentMethod: payment.method,
      resultingStatus: receivable.status,
      resultingVersion: receivable.version,
    });
    return RecordSalesPaymentResponseSchema.parse({ payment, receivable });
  }

  private static async loadIdempotency(
    orgId: string,
    clientRequestId: string,
  ): Promise<SalesPaymentIdempotencyRecord | undefined> {
    try {
      return await SalesPaymentRepository.getIdempotency(orgId, clientRequestId);
    } catch (error) {
      console.error("[SALES_RECEIVABLE_INTEGRITY]", {
        event: "IDEMPOTENCY_RECORD_READ_FAILED",
        orgId,
        reason: error instanceof Error ? error.name : "UNKNOWN",
      });
      throw new AppError(500, "SALES_PAYMENT_IDEMPOTENCY_INTEGRITY_ERROR");
    }
  }
}
