import { randomUUID } from "crypto";
import {
  AddSalesCreditNoteLineRequest,
  AddSalesCreditNoteLineRequestSchema,
  CreateSalesCreditNoteRequest,
  CreateSalesCreditNoteRequestSchema,
  IssueSalesCreditNoteRequest,
  IssueSalesCreditNoteRequestSchema,
  IssueSalesCreditNoteResponse,
  IssueSalesCreditNoteResponseSchema,
  ListSalesCreditNotesRequestSchema,
  SalesCreditNote,
  SalesCreditNoteListResponse,
  SalesCreditNoteListResponseSchema,
  SalesCreditNoteSchema,
  SalesIssuedInvoice,
  SalesIssuedCreditNoteSchema,
  UpdateSalesCreditNoteLineRequest,
  UpdateSalesCreditNoteLineRequestSchema,
  UpdateSalesCreditNoteRequest,
  UpdateSalesCreditNoteRequestSchema,
} from "@liass-ohada/shared/sales";
import { z } from "zod";
import { AppError } from "@/lambda/shared/app-error";
import { SalesCreditNoteCalculator } from "./sales-credit-note-calculator";
import { formatSalesCreditNoteNumber, nextSalesCreditNoteSequence } from "./sales-credit-note-number";
import {
  SalesCreditNoteIssueIdempotencyRecord,
  SalesCreditNoteIssueTransactionError,
  SalesCreditNoteRepository,
  SalesCreditNoteWriteConflictError,
} from "./sales-credit-note-repository";
import { SalesInvoiceCalculator } from "./sales-invoice-calculator";
import { SalesInvoiceService } from "./sales-invoice-service";
import { SalesPaymentService } from "./sales-payment-service";
import { SalesReceivableCalculator } from "./sales-receivable-calculator";

const Id = z.string().trim().min(1).max(200);
const Org = z.string().min(1);
const MAX_LINES = 100;
const MAX_SEQUENCE_ATTEMPTS = 4;

const audit = (input: Record<string, unknown>) => console.info("[SALES_CREDIT_NOTE_AUDIT]", input);

export class SalesCreditNoteService {
  static async create(orgId: string, actorUserId: string, invoiceId: string,
    input: CreateSalesCreditNoteRequest): Promise<SalesCreditNote> {
    const tenantId = Org.parse(orgId);
    const source = await this.issuedInvoice(tenantId, Id.parse(invoiceId));
    const request = CreateSalesCreditNoteRequestSchema.parse(input);
    const now = new Date().toISOString();
    const note = SalesCreditNoteSchema.parse({
      id: `SCN-${randomUUID()}`, originalInvoiceId: source.id,
      originalInvoiceNumber: source.invoiceNumber, status: "DRAFT",
      customerSnapshot: source.customerSnapshot, currency: source.currency, reason: request.reason,
      lines: [], subtotal: "0", taxTotal: "0", total: "0", lineCount: 0,
      version: 1, createdAt: now, updatedAt: now,
    });
    try { await SalesCreditNoteRepository.create(tenantId, note); }
    catch (error) {
      if (error instanceof SalesCreditNoteWriteConflictError) throw new AppError(409, "SALES_CREDIT_NOTE_CREATE_CONFLICT");
      throw error;
    }
    audit({ action: "DRAFT_CREATED", actorUserId, creditNoteId: note.id, invoiceId: source.id, orgId: tenantId, version: 1 });
    return note;
  }

  static async get(orgId: string, invoiceId: string, creditNoteId: string): Promise<SalesCreditNote> {
    const note = await SalesCreditNoteRepository.get(Org.parse(orgId), Id.parse(invoiceId), Id.parse(creditNoteId));
    if (!note) throw new AppError(404, "SALES_CREDIT_NOTE_NOT_FOUND");
    return note;
  }

  static async list(orgId: string, invoiceId: string, input: unknown): Promise<SalesCreditNoteListResponse> {
    const request = ListSalesCreditNotesRequestSchema.parse(input);
    await this.issuedInvoice(Org.parse(orgId), Id.parse(invoiceId));
    return SalesCreditNoteListResponseSchema.parse(await SalesCreditNoteRepository.list(orgId, invoiceId, request));
  }

  static async update(orgId: string, actorUserId: string, invoiceId: string, creditNoteId: string,
    input: UpdateSalesCreditNoteRequest): Promise<SalesCreditNote> {
    const request = UpdateSalesCreditNoteRequestSchema.parse(input);
    const current = await this.get(orgId, invoiceId, creditNoteId);
    this.assertDraft(current, request.expectedVersion);
    const { reason: _reason, ...rest } = current;
    const now = new Date().toISOString();
    const next = SalesCreditNoteSchema.parse({ ...rest, ...(request.reason ? { reason: request.reason } : {}),
      version: current.version + 1, updatedAt: now });
    await this.persist(orgId, next, request.expectedVersion);
    audit({ action: "DRAFT_UPDATED", actorUserId, creditNoteId, invoiceId, orgId, version: next.version });
    return next;
  }

  static async addLine(orgId: string, actorUserId: string, invoiceId: string, creditNoteId: string,
    input: AddSalesCreditNoteLineRequest): Promise<SalesCreditNote> {
    const request = AddSalesCreditNoteLineRequestSchema.parse(input);
    const current = await this.get(orgId, invoiceId, creditNoteId);
    this.assertDraft(current, request.expectedVersion);
    if (current.lineCount >= MAX_LINES) throw new AppError(409, "MAX_CREDIT_NOTE_LINES_EXCEEDED");
    if (current.lines.some((line) => line.originalInvoiceLineId === request.originalInvoiceLineId))
      throw new AppError(409, "SALES_CREDIT_NOTE_SOURCE_LINE_DUPLICATE");
    const source = await this.issuedInvoice(orgId, invoiceId);
    const sourceLine = source.lines.find((line) => line.id === request.originalInvoiceLineId);
    if (!sourceLine) throw new AppError(404, "SALES_CREDIT_NOTE_SOURCE_LINE_NOT_FOUND");
    const now = new Date().toISOString();
    const line = SalesCreditNoteCalculator.calculateLine({ currency: current.currency,
      id: `SCL-${randomUUID()}`, originalLine: sourceLine, position: current.lineCount + 1,
      quantity: request.quantity, timestamp: now });
    const next = this.withLines(current, [...current.lines, line], now);
    await this.persist(orgId, next, request.expectedVersion);
    audit({ action: "LINE_ADDED", actorUserId, creditNoteId, invoiceId, lineId: line.id, orgId, version: next.version });
    return next;
  }

  static async updateLine(orgId: string, actorUserId: string, invoiceId: string, creditNoteId: string,
    lineId: string, input: UpdateSalesCreditNoteLineRequest): Promise<SalesCreditNote> {
    const request = UpdateSalesCreditNoteLineRequestSchema.parse(input);
    const current = await this.get(orgId, invoiceId, creditNoteId);
    this.assertDraft(current, request.expectedVersion);
    const existing = current.lines.find((line) => line.id === Id.parse(lineId));
    if (!existing) throw new AppError(404, "SALES_CREDIT_NOTE_LINE_NOT_FOUND");
    const source = await this.issuedInvoice(orgId, invoiceId);
    const sourceLine = source.lines.find((line) => line.id === existing.originalInvoiceLineId);
    if (!sourceLine) throw new AppError(500, "SALES_CREDIT_NOTE_INTEGRITY_ERROR");
    const now = new Date().toISOString();
    const line = SalesCreditNoteCalculator.calculateLine({ currency: current.currency, id: existing.id,
      originalLine: sourceLine, position: existing.position, quantity: request.quantity,
      timestamp: existing.createdAt });
    line.updatedAt = now;
    const next = this.withLines(current, current.lines.map((candidate) => candidate.id === line.id ? line : candidate), now);
    await this.persist(orgId, next, request.expectedVersion);
    audit({ action: "LINE_UPDATED", actorUserId, creditNoteId, invoiceId, lineId, orgId, version: next.version });
    return next;
  }

  static async removeLine(orgId: string, actorUserId: string, invoiceId: string, creditNoteId: string,
    lineId: string, expectedVersion: number): Promise<SalesCreditNote> {
    const current = await this.get(orgId, invoiceId, creditNoteId);
    this.assertDraft(current, expectedVersion);
    if (!current.lines.some((line) => line.id === Id.parse(lineId)))
      throw new AppError(404, "SALES_CREDIT_NOTE_LINE_NOT_FOUND");
    const now = new Date().toISOString();
    const next = this.withLines(current, current.lines.filter((line) => line.id !== lineId)
      .map((line, index) => ({ ...line, position: index + 1 })), now);
    await this.persist(orgId, next, expectedVersion);
    audit({ action: "LINE_REMOVED", actorUserId, creditNoteId, invoiceId, lineId, orgId, version: next.version });
    return next;
  }

  static async issue(orgId: string, actorUserId: string, invoiceId: string, creditNoteId: string,
    input: IssueSalesCreditNoteRequest): Promise<IssueSalesCreditNoteResponse> {
    const request = IssueSalesCreditNoteRequestSchema.parse(input);
    const existing = await SalesCreditNoteRepository.getIssueIdempotency(orgId, request.clientRequestId);
    if (existing) return this.replay(orgId, invoiceId, creditNoteId, request, existing);
    for (let attempt = 0; attempt < MAX_SEQUENCE_ATTEMPTS; attempt += 1) {
      const note = await this.get(orgId, invoiceId, creditNoteId);
      this.assertDraft(note, request.expectedCreditNoteVersion);
      if (!note.reason) throw new AppError(409, "SALES_CREDIT_NOTE_REASON_REQUIRED");
      if (!note.lineCount) throw new AppError(409, "SALES_CREDIT_NOTE_HAS_NO_LINES");
      const invoice = await this.issuedInvoice(orgId, invoiceId);
      this.assertSource(note, invoice);
      const state = await SalesPaymentService.loadCanonicalReceivableState(orgId, invoice);
      if (state.receivable.version !== request.expectedReceivableVersion)
        throw new AppError(409, "SALES_RECEIVABLE_VERSION_CONFLICT");
      if (state.receivable.balanceDue === "0") throw new AppError(409, "SALES_INVOICE_ALREADY_SETTLED");
      const nextQuantities = { ...state.creditedLineQuantities };
      for (const line of note.lines) {
        const source = invoice.lines.find((candidate) => candidate.id === line.originalInvoiceLineId);
        if (!source) throw new AppError(500, "SALES_CREDIT_NOTE_INTEGRITY_ERROR");
        const cumulative = SalesCreditNoteCalculator.addQuantities(nextQuantities[source.id] ?? "0", line.quantity);
        if (SalesCreditNoteCalculator.compareQuantity(cumulative, source.quantity) > 0)
          throw new AppError(409, "SALES_CREDIT_NOTE_CUMULATIVE_QUANTITY_EXCEEDED");
        nextQuantities[source.id] = cumulative;
      }
      const now = new Date().toISOString();
      const receivable = SalesReceivableCalculator.applyCredit(state.receivable, note.total, now);
      const sequence = await SalesCreditNoteRepository.getSequence(orgId);
      const nextSequenceValue = nextSalesCreditNoteSequence(sequence.lastValue);
      const issued = SalesIssuedCreditNoteSchema.parse({ ...note, status: "ISSUED",
        creditNoteNumber: formatSalesCreditNoteNumber(nextSequenceValue), issueDate: request.issueDate,
        issuedAt: now, updatedAt: now, version: note.version + 1 });
      try {
        await SalesCreditNoteRepository.issueAtomically({ orgId, invoiceId, creditNote: issued,
          issuedByUserId: Id.parse(actorUserId), receivable, creditedLineQuantities: nextQuantities,
          clientRequestId: request.clientRequestId,
          originalExpectedCreditNoteVersion: request.expectedCreditNoteVersion,
          originalExpectedReceivableVersion: request.expectedReceivableVersion,
          previousSequenceExists: sequence.exists, previousSequenceValue: sequence.lastValue, nextSequenceValue });
        audit({ action: "ISSUED", actorUserId, creditNoteId, creditNoteNumber: issued.creditNoteNumber,
          invoiceId, orgId, receivableStatus: receivable.status, receivableVersion: receivable.version });
        return IssueSalesCreditNoteResponseSchema.parse({ creditNote: issued, receivable });
      } catch (error) {
        if (!(error instanceof SalesCreditNoteIssueTransactionError)) throw error;
        const winner = await SalesCreditNoteRepository.getIssueIdempotency(orgId, request.clientRequestId);
        if (winner) return this.replay(orgId, invoiceId, creditNoteId, request, winner);
        if (error.failure === "SEQUENCE_CONTENTION") continue;
        if (error.failure === "CREDIT_NOTE_CONFLICT") throw new AppError(409, "SALES_CREDIT_NOTE_VERSION_CONFLICT");
        if (error.failure === "RECEIVABLE_CONFLICT") throw new AppError(409, "SALES_RECEIVABLE_VERSION_CONFLICT");
        throw new AppError(409, "SALES_CREDIT_NOTE_ISSUE_CONCURRENCY_CONFLICT");
      }
    }
    throw new AppError(409, "SALES_CREDIT_NOTE_SEQUENCE_CONTENTION");
  }

  private static async issuedInvoice(orgId: string, invoiceId: string): Promise<SalesIssuedInvoice> {
    const invoice = await SalesInvoiceService.get(Org.parse(orgId), Id.parse(invoiceId));
    if (invoice.status !== "ISSUED") throw new AppError(409, "SALES_CREDIT_NOTE_REQUIRES_ISSUED_INVOICE");
    return invoice;
  }

  private static assertDraft(note: SalesCreditNote, version: number) {
    if (note.status !== "DRAFT") throw new AppError(409, "SALES_CREDIT_NOTE_NOT_EDITABLE");
    if (note.version !== version) throw new AppError(409, "SALES_CREDIT_NOTE_VERSION_CONFLICT");
  }

  private static assertSource(note: SalesCreditNote, invoice: SalesIssuedInvoice) {
    if (note.originalInvoiceId !== invoice.id || note.originalInvoiceNumber !== invoice.invoiceNumber ||
      note.currency !== invoice.currency || JSON.stringify(note.customerSnapshot) !== JSON.stringify(invoice.customerSnapshot))
      throw new AppError(500, "SALES_CREDIT_NOTE_INTEGRITY_ERROR");
  }

  private static withLines(current: SalesCreditNote, lines: SalesCreditNote["lines"], timestamp: string): SalesCreditNote {
    const totals = SalesInvoiceCalculator.calculateTotals(current.currency, lines);
    return SalesCreditNoteSchema.parse({ ...current, lines, ...totals,
      lineCount: lines.length, version: current.version + 1, updatedAt: timestamp });
  }

  private static async persist(orgId: string, note: SalesCreditNote, version: number) {
    try { await SalesCreditNoteRepository.update(orgId, note, version); }
    catch (error) {
      if (error instanceof SalesCreditNoteWriteConflictError) throw new AppError(409, "SALES_CREDIT_NOTE_VERSION_CONFLICT");
      throw error;
    }
  }

  private static async replay(orgId: string, invoiceId: string, creditNoteId: string,
    request: IssueSalesCreditNoteRequest, record: SalesCreditNoteIssueIdempotencyRecord): Promise<IssueSalesCreditNoteResponse> {
    if (record.invoiceId !== invoiceId || record.creditNoteId !== creditNoteId || record.issueDate !== request.issueDate ||
      record.originalExpectedCreditNoteVersion !== request.expectedCreditNoteVersion ||
      record.originalExpectedReceivableVersion !== request.expectedReceivableVersion)
      throw new AppError(409, "SALES_CREDIT_NOTE_IDEMPOTENCY_KEY_REUSED");
    const note = await SalesCreditNoteRepository.get(orgId, invoiceId, creditNoteId);
    if (!note || note.status !== "ISSUED" || note.creditNoteNumber !== record.creditNoteNumber)
      throw new AppError(500, "SALES_CREDIT_NOTE_IDEMPOTENCY_INTEGRITY_ERROR");
    const invoice = await this.issuedInvoice(orgId, invoiceId);
    const receivable = (await SalesPaymentService.loadCanonicalReceivableState(orgId, invoice)).receivable;
    audit({ action: "ISSUE_REPLAYED", creditNoteId, invoiceId, orgId,
      creditNoteNumber: note.creditNoteNumber, receivableStatus: receivable.status, receivableVersion: receivable.version });
    return IssueSalesCreditNoteResponseSchema.parse({ creditNote: note, receivable });
  }
}
