import { randomUUID } from "crypto";
import {
  AddSalesInvoiceLineRequest,
  AddSalesInvoiceLineRequestSchema,
  CreateSalesInvoiceRequest,
  CreateSalesInvoiceRequestSchema,
  IssueSalesInvoiceRequest,
  IssueSalesInvoiceRequestSchema,
  ListSalesInvoicesRequest,
  ListSalesInvoicesRequestSchema,
  SalesInvoice,
  SalesInvoiceCustomerSnapshot,
  SalesInvoiceListResponse,
  SalesInvoiceListResponseSchema,
  SalesInvoiceSchema,
  SalesDraftInvoice,
  SalesIssuedInvoice,
  UpdateSalesInvoiceLineRequest,
  UpdateSalesInvoiceLineRequestSchema,
  UpdateSalesInvoiceRequest,
  UpdateSalesInvoiceRequestSchema,
} from "@liass-ohada/shared/sales";
import { z } from "zod";
import { AppError } from "@/lambda/shared/app-error";
import { SalesCatalogItemService } from "../catalog/sales-catalog-item-service";
import { SalesCustomerService } from "../customers/sales-customer-service";
import { SalesSettingsService } from "../settings/sales-settings-service";
import { resolveSalesCurrency } from "./sales-currency";
import { SalesInvoiceCalculator } from "./sales-invoice-calculator";
import {
  formatSalesInvoiceNumber,
  nextSalesInvoiceSequence,
} from "./sales-invoice-number";
import {
  SalesInvoiceIssueIdempotencyRecord,
  SalesInvoiceIssueTransactionError,
  SalesInvoiceRepository,
  SalesInvoiceWriteConflictError,
} from "./sales-invoice-repository";

const OrganizationIdSchema = z.string().min(1);
const EntityIdSchema = z.string().trim().min(1).max(200);
const MAX_INVOICE_LINES = 100;
const MAX_ISSUE_SEQUENCE_ATTEMPTS = 4;

type AuditAction =
  | "SALES_INVOICE_DRAFT_CREATED"
  | "SALES_INVOICE_DRAFT_UPDATED"
  | "SALES_INVOICE_LINE_ADDED"
  | "SALES_INVOICE_LINE_UPDATED"
  | "SALES_INVOICE_LINE_REMOVED"
  | "SALES_INVOICE_ISSUED";

const audit = (input: {
  action: AuditAction;
  actorUserId: string;
  currency: string;
  invoiceId: string;
  lineCount: number;
  lineId?: string;
  orgId: string;
  resultingVersion: number;
  timestamp: string;
  invoiceNumber?: string;
  issueDate?: string;
}) => console.info("[SALES_INVOICE_AUDIT]", input);

const customerSnapshot = async (
  orgId: string,
  customerId: string,
): Promise<SalesInvoiceCustomerSnapshot> => {
  const customer = await SalesCustomerService.get(orgId, customerId);
  if (!customer.isActive) {
    throw new AppError(409, "SALES_CUSTOMER_INACTIVE");
  }
  return {
    name: customer.name,
    email: customer.email,
    phone: customer.phone,
    taxIdentifier: customer.taxIdentifier,
    billingAddress: customer.billingAddress,
  };
};

export class SalesInvoiceService {
  static async create(
    orgId: string,
    actorUserId: string,
    input: CreateSalesInvoiceRequest,
  ): Promise<SalesInvoice> {
    const tenantId = OrganizationIdSchema.parse(orgId);
    const request = CreateSalesInvoiceRequestSchema.parse(input);
    const currency = request.currency ?? (await this.defaultCurrency(tenantId));
    resolveSalesCurrency(currency);
    const snapshot = request.customerId
      ? await customerSnapshot(tenantId, request.customerId)
      : undefined;
    const now = new Date().toISOString();
    const invoice = SalesInvoiceSchema.parse({
      id: `SINV-${randomUUID()}`,
      status: "DRAFT",
      currency,
      ...(request.customerId && snapshot
        ? { customerId: request.customerId, customerSnapshot: snapshot }
        : {}),
      lines: [],
      subtotal: "0",
      taxTotal: "0",
      total: "0",
      lineCount: 0,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });

    try {
      await SalesInvoiceRepository.create(tenantId, invoice);
    } catch (error) {
      if (error instanceof SalesInvoiceWriteConflictError) {
        throw new AppError(409, "SALES_INVOICE_CREATE_CONFLICT");
      }
      throw error;
    }
    audit({
      action: "SALES_INVOICE_DRAFT_CREATED",
      actorUserId,
      currency,
      invoiceId: invoice.id,
      lineCount: 0,
      orgId: tenantId,
      resultingVersion: 1,
      timestamp: now,
    });
    return invoice;
  }

  static async get(orgId: string, invoiceId: string): Promise<SalesInvoice> {
    const invoice = await SalesInvoiceRepository.get(
      OrganizationIdSchema.parse(orgId),
      EntityIdSchema.parse(invoiceId),
    );
    if (!invoice) throw new AppError(404, "SALES_INVOICE_NOT_FOUND");
    return invoice;
  }

  static async list(
    orgId: string,
    input: ListSalesInvoicesRequest,
  ): Promise<SalesInvoiceListResponse> {
    const request = ListSalesInvoicesRequestSchema.parse(input);
    return SalesInvoiceListResponseSchema.parse(
      await SalesInvoiceRepository.list(
        OrganizationIdSchema.parse(orgId),
        request,
      ),
    );
  }

  static async update(
    orgId: string,
    actorUserId: string,
    invoiceId: string,
    input: UpdateSalesInvoiceRequest,
  ): Promise<SalesInvoice> {
    const tenantId = OrganizationIdSchema.parse(orgId);
    const id = EntityIdSchema.parse(invoiceId);
    const request = UpdateSalesInvoiceRequestSchema.parse(input);
    const current = await this.get(tenantId, id);
    this.assertDraftEditable(current);
    this.assertVersion(current, request.expectedVersion);

    let nextCustomerId = current.customerId;
    let nextSnapshot = current.customerSnapshot;
    let customerWasSubmitted = false;
    if (Object.prototype.hasOwnProperty.call(request, "customerId")) {
      customerWasSubmitted = true;
      if (request.customerId === null) {
        nextCustomerId = undefined;
        nextSnapshot = undefined;
      } else if (request.customerId) {
        nextCustomerId = request.customerId;
        nextSnapshot = await customerSnapshot(tenantId, request.customerId);
      }
    }

    let nextCurrency = current.currency;
    if (request.currency) {
      resolveSalesCurrency(request.currency);
      if (request.currency !== current.currency && current.lineCount > 0) {
        throw new AppError(409, "INVOICE_CURRENCY_LOCKED");
      }
      nextCurrency = request.currency;
    }

    if (
      !customerWasSubmitted &&
      nextCurrency === current.currency
    ) {
      return current;
    }

    const now = new Date().toISOString();
    const {
      customerId: _currentCustomerId,
      customerSnapshot: _currentCustomerSnapshot,
      ...currentWithoutCustomer
    } = current;
    const next = SalesInvoiceSchema.parse({
      ...currentWithoutCustomer,
      currency: nextCurrency,
      ...(nextCustomerId && nextSnapshot
        ? { customerId: nextCustomerId, customerSnapshot: nextSnapshot }
        : {}),
      version: current.version + 1,
      updatedAt: now,
    });
    await this.persist(tenantId, next, request.expectedVersion);
    audit({
      action: "SALES_INVOICE_DRAFT_UPDATED",
      actorUserId,
      currency: next.currency,
      invoiceId: id,
      lineCount: next.lineCount,
      orgId: tenantId,
      resultingVersion: next.version,
      timestamp: now,
    });
    return next;
  }

  static async addLine(
    orgId: string,
    actorUserId: string,
    invoiceId: string,
    input: AddSalesInvoiceLineRequest,
  ): Promise<SalesInvoice> {
    const tenantId = OrganizationIdSchema.parse(orgId);
    const id = EntityIdSchema.parse(invoiceId);
    const request = AddSalesInvoiceLineRequestSchema.parse(input);
    const current = await this.get(tenantId, id);
    this.assertDraftEditable(current);
    this.assertVersion(current, request.expectedVersion);
    if (current.lineCount >= MAX_INVOICE_LINES) {
      throw new AppError(409, "MAX_INVOICE_LINES_EXCEEDED");
    }

    let description = request.description;
    let unit = request.unit;
    if (request.catalogItemId) {
      const item = await SalesCatalogItemService.get(
        tenantId,
        request.catalogItemId,
      );
      if (!item.isActive) throw new AppError(409, "SALES_ITEM_INACTIVE");
      description ??= item.name;
      unit ??= item.unit;
    }
    if (!description) throw new AppError(400, "ERROR_INVALID_INPUT");

    const now = new Date().toISOString();
    const line = SalesInvoiceCalculator.calculateLine(current.currency, {
      id: `SIL-${randomUUID()}`,
      position: current.version,
      catalogItemId: request.catalogItemId,
      description,
      unit,
      quantity: request.quantity,
      unitPrice: request.unitPrice,
      taxRate: request.taxRate ?? "0",
      createdAt: now,
      updatedAt: now,
    });
    const next = this.withLines(current, [...current.lines, line], now);
    await this.persist(tenantId, next, request.expectedVersion);
    audit({
      action: "SALES_INVOICE_LINE_ADDED",
      actorUserId,
      currency: next.currency,
      invoiceId: id,
      lineCount: next.lineCount,
      lineId: line.id,
      orgId: tenantId,
      resultingVersion: next.version,
      timestamp: now,
    });
    return next;
  }

  static async updateLine(
    orgId: string,
    actorUserId: string,
    invoiceId: string,
    lineId: string,
    input: UpdateSalesInvoiceLineRequest,
  ): Promise<SalesInvoice> {
    const tenantId = OrganizationIdSchema.parse(orgId);
    const id = EntityIdSchema.parse(invoiceId);
    const targetLineId = EntityIdSchema.parse(lineId);
    const request = UpdateSalesInvoiceLineRequestSchema.parse(input);
    const current = await this.get(tenantId, id);
    this.assertDraftEditable(current);
    this.assertVersion(current, request.expectedVersion);
    const existing = current.lines.find((line) => line.id === targetLineId);
    if (!existing) throw new AppError(404, "SALES_INVOICE_LINE_NOT_FOUND");

    const mutable = { ...existing } as Record<string, unknown>;
    for (const field of [
      "description",
      "unit",
      "quantity",
      "unitPrice",
      "taxRate",
    ] as const) {
      if (!Object.prototype.hasOwnProperty.call(request, field)) continue;
      const value = request[field];
      if (value === null) delete mutable[field];
      else if (value !== undefined) mutable[field] = value;
    }
    const now = new Date().toISOString();
    const updated = SalesInvoiceCalculator.calculateLine(current.currency, {
      id: existing.id,
      position: existing.position,
      catalogItemId: existing.catalogItemId,
      description: String(mutable.description),
      unit: mutable.unit as string | undefined,
      quantity: String(mutable.quantity),
      unitPrice: String(mutable.unitPrice),
      taxRate: String(mutable.taxRate),
      createdAt: existing.createdAt,
      updatedAt: now,
    });
    const lines = current.lines.map((line) =>
      line.id === targetLineId ? updated : line,
    );
    const next = this.withLines(current, lines, now);
    await this.persist(tenantId, next, request.expectedVersion);
    audit({
      action: "SALES_INVOICE_LINE_UPDATED",
      actorUserId,
      currency: next.currency,
      invoiceId: id,
      lineCount: next.lineCount,
      lineId: targetLineId,
      orgId: tenantId,
      resultingVersion: next.version,
      timestamp: now,
    });
    return next;
  }

  static async removeLine(
    orgId: string,
    actorUserId: string,
    invoiceId: string,
    lineId: string,
    expectedVersion: number,
  ): Promise<SalesInvoice> {
    const tenantId = OrganizationIdSchema.parse(orgId);
    const id = EntityIdSchema.parse(invoiceId);
    const targetLineId = EntityIdSchema.parse(lineId);
    const current = await this.get(tenantId, id);
    this.assertDraftEditable(current);
    this.assertVersion(current, expectedVersion);
    if (!current.lines.some((line) => line.id === targetLineId)) {
      throw new AppError(404, "SALES_INVOICE_LINE_NOT_FOUND");
    }
    const now = new Date().toISOString();
    const next = this.withLines(
      current,
      current.lines.filter((line) => line.id !== targetLineId),
      now,
    );
    await this.persist(tenantId, next, expectedVersion);
    audit({
      action: "SALES_INVOICE_LINE_REMOVED",
      actorUserId,
      currency: next.currency,
      invoiceId: id,
      lineCount: next.lineCount,
      lineId: targetLineId,
      orgId: tenantId,
      resultingVersion: next.version,
      timestamp: now,
    });
    return next;
  }

  static async issue(
    orgId: string,
    actorUserId: string,
    invoiceId: string,
    input: IssueSalesInvoiceRequest,
  ): Promise<SalesIssuedInvoice> {
    const tenantId = OrganizationIdSchema.parse(orgId);
    const userId = EntityIdSchema.parse(actorUserId);
    const id = EntityIdSchema.parse(invoiceId);
    const request = IssueSalesInvoiceRequestSchema.parse(input);
    const existing = await SalesInvoiceRepository.getIssueIdempotency(
      tenantId,
      request.clientRequestId,
    );
    if (existing) return this.resolveIssueReplay(tenantId, id, request, existing);

    for (let attempt = 1; attempt <= MAX_ISSUE_SEQUENCE_ATTEMPTS; attempt += 1) {
      const current = await this.get(tenantId, id);
      if (current.status === "ISSUED") {
        throw new AppError(409, "SALES_INVOICE_ALREADY_ISSUED");
      }
      this.assertVersion(current, request.expectedVersion);
      if (current.lineCount < 1 || current.lines.length < 1) {
        throw new AppError(409, "SALES_INVOICE_HAS_NO_LINES");
      }

      const sequence = await SalesInvoiceRepository.getSequence(tenantId);
      const nextSequenceValue = nextSalesInvoiceSequence(sequence.lastValue);
      const invoiceNumber = formatSalesInvoiceNumber(nextSequenceValue);
      const issuedAt = new Date().toISOString();
      const issued = SalesInvoiceSchema.parse({
        ...current,
        status: "ISSUED",
        invoiceNumber,
        issueDate: request.issueDate,
        issuedAt,
        version: current.version + 1,
        updatedAt: issuedAt,
      }) as SalesIssuedInvoice;

      try {
        await SalesInvoiceRepository.issueAtomically({
          orgId: tenantId,
          invoice: issued,
          issuedByUserId: userId,
          clientRequestId: request.clientRequestId,
          originalExpectedVersion: request.expectedVersion,
          previousSequenceExists: sequence.exists,
          previousSequenceValue: sequence.lastValue,
          nextSequenceValue,
        });
        audit({
          action: "SALES_INVOICE_ISSUED",
          actorUserId: userId,
          currency: issued.currency,
          invoiceId: id,
          invoiceNumber,
          issueDate: request.issueDate,
          lineCount: issued.lineCount,
          orgId: tenantId,
          resultingVersion: issued.version,
          timestamp: issuedAt,
        });
        return issued;
      } catch (error) {
        if (!(error instanceof SalesInvoiceIssueTransactionError)) throw error;

        const winner = await SalesInvoiceRepository.getIssueIdempotency(
          tenantId,
          request.clientRequestId,
        );
        if (winner) return this.resolveIssueReplay(tenantId, id, request, winner);

        const authoritative = await SalesInvoiceRepository.get(tenantId, id);
        if (!authoritative) throw new AppError(404, "SALES_INVOICE_NOT_FOUND");
        if (authoritative.status === "ISSUED") {
          throw new AppError(409, "SALES_INVOICE_ALREADY_ISSUED");
        }
        this.assertVersion(authoritative, request.expectedVersion);

        if (error.failure === "SEQUENCE_CONTENTION") continue;
        console.error("[SALES_INVOICE_ISSUANCE_INTEGRITY]", {
          event: "ISSUE_TRANSACTION_FAILURE",
          failure: error.failure,
          invoiceId: id,
          orgId: tenantId,
        });
        throw new AppError(409, "SALES_INVOICE_ISSUE_CONCURRENCY_CONFLICT");
      }
    }

    console.warn("[SALES_INVOICE_ISSUANCE_INTEGRITY]", {
      event: "SEQUENCE_CONTENTION_EXHAUSTED",
      invoiceId: id,
      orgId: tenantId,
      attempts: MAX_ISSUE_SEQUENCE_ATTEMPTS,
    });
    throw new AppError(409, "SALES_INVOICE_SEQUENCE_CONTENTION");
  }

  private static withLines(
    current: SalesDraftInvoice,
    lines: SalesInvoice["lines"],
    timestamp: string,
  ): SalesDraftInvoice {
    return SalesInvoiceSchema.parse({
      ...current,
      lines,
      ...SalesInvoiceCalculator.calculateTotals(current.currency, lines),
      lineCount: lines.length,
      version: current.version + 1,
      updatedAt: timestamp,
    }) as SalesDraftInvoice;
  }

  private static assertDraftEditable(
    invoice: SalesInvoice,
  ): asserts invoice is SalesDraftInvoice {
    if (invoice.status !== "DRAFT") {
      throw new AppError(409, "SALES_INVOICE_NOT_EDITABLE");
    }
  }

  private static async resolveIssueReplay(
    orgId: string,
    invoiceId: string,
    request: IssueSalesInvoiceRequest,
    record: SalesInvoiceIssueIdempotencyRecord,
  ): Promise<SalesIssuedInvoice> {
    if (
      record.invoiceId !== invoiceId ||
      record.issueDate !== request.issueDate ||
      record.originalExpectedVersion !== request.expectedVersion
    ) {
      throw new AppError(409, "SALES_INVOICE_IDEMPOTENCY_KEY_REUSED");
    }
    const invoice = await SalesInvoiceRepository.get(orgId, record.invoiceId);
    if (
      !invoice ||
      invoice.status !== "ISSUED" ||
      invoice.invoiceNumber !== record.invoiceNumber
    ) {
      console.error("[SALES_INVOICE_ISSUANCE_INTEGRITY]", {
        event: "IDEMPOTENCY_RECORD_MISMATCH",
        invoiceId: record.invoiceId,
        orgId,
      });
      throw new AppError(500, "SALES_INVOICE_ISSUANCE_INTEGRITY_ERROR");
    }
    return invoice;
  }

  private static assertVersion(
    invoice: SalesInvoice,
    expectedVersion: number,
  ): void {
    if (invoice.version !== expectedVersion) {
      throw new AppError(409, "SALES_INVOICE_VERSION_CONFLICT");
    }
  }

  private static async persist(
    orgId: string,
    invoice: SalesInvoice,
    expectedVersion: number,
  ): Promise<void> {
    try {
      await SalesInvoiceRepository.update(orgId, invoice, expectedVersion);
    } catch (error) {
      if (error instanceof SalesInvoiceWriteConflictError) {
        throw new AppError(409, "SALES_INVOICE_VERSION_CONFLICT");
      }
      throw error;
    }
  }

  private static async defaultCurrency(orgId: string): Promise<string> {
    const settings = await SalesSettingsService.getSalesSettings(orgId);
    if (!settings) throw new AppError(409, "SALES_SETTINGS_NOT_FOUND");
    return settings.defaultCurrency;
  }
}
