import { z } from "zod";
import {
  SalesInvoiceCustomerSnapshotSchema,
  SalesInvoiceIssueDateSchema,
  SalesInvoiceMoneySchema,
  SalesInvoiceQuantitySchema,
  SalesInvoiceTaxRateSchema,
  SalesInvoiceUnitPriceSchema,
} from "./sales-invoice";
import { SalesInvoiceReceivableSchema } from "./sales-payment";
import { CurrencyCodeSchema } from "./sales-settings";

const optionalReason = z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().trim().min(1).max(1000).optional(),
);

export const SalesCreditNoteStatusSchema = z.enum(["DRAFT", "ISSUED"]);

export const SalesCreditNoteLineSchema = z.object({
  id: z.string().min(1),
  originalInvoiceLineId: z.string().min(1),
  position: z.number().int().positive(),
  description: z.string().trim().min(1).max(2000),
  unit: z.string().trim().min(1).max(80).optional(),
  quantity: SalesInvoiceQuantitySchema,
  unitPrice: SalesInvoiceUnitPriceSchema,
  taxRate: SalesInvoiceTaxRateSchema,
  subtotal: SalesInvoiceMoneySchema,
  taxAmount: SalesInvoiceMoneySchema,
  total: SalesInvoiceMoneySchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict();

const header = {
  id: z.string().min(1),
  originalInvoiceId: z.string().min(1),
  originalInvoiceNumber: z.string().regex(/^0*[1-9]\d*$/),
  customerSnapshot: SalesInvoiceCustomerSnapshotSchema.optional(),
  currency: CurrencyCodeSchema,
  reason: z.string().trim().min(1).max(1000).optional(),
  lines: z.array(SalesCreditNoteLineSchema).max(100),
  subtotal: SalesInvoiceMoneySchema,
  taxTotal: SalesInvoiceMoneySchema,
  total: SalesInvoiceMoneySchema,
  lineCount: z.number().int().min(0).max(100),
  version: z.number().int().positive(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
};

const countsMatch = (value: { lineCount: number; lines: unknown[] }) =>
  value.lineCount === value.lines.length;

export const SalesDraftCreditNoteSchema = z.object({
  ...header,
  status: z.literal("DRAFT"),
}).strict().refine(countsMatch, { path: ["lineCount"], message: "Credit Note line count must match lines" });

export const SalesIssuedCreditNoteSchema = z.object({
  ...header,
  status: z.literal("ISSUED"),
  creditNoteNumber: z.string().regex(/^0*[1-9]\d*$/),
  issueDate: SalesInvoiceIssueDateSchema,
  issuedAt: z.string().datetime(),
}).strict()
  .refine(countsMatch, { path: ["lineCount"], message: "Credit Note line count must match lines" })
  .refine((value) => value.lineCount > 0, { path: ["lineCount"], message: "Issued Credit Note must contain a line" })
  .refine((value) => !!value.reason, { path: ["reason"], message: "Issued Credit Note requires a reason" });

export const SalesCreditNoteSchema = z.union([
  SalesDraftCreditNoteSchema,
  SalesIssuedCreditNoteSchema,
]);

const { lines: _summaryLines, ...summaryHeader } = header;
export const SalesCreditNoteSummarySchema = z.union([
  z.object({ ...summaryHeader, status: z.literal("DRAFT") }).strict(),
  z.object({
    ...summaryHeader,
    status: z.literal("ISSUED"),
    creditNoteNumber: z.string().regex(/^0*[1-9]\d*$/),
    issueDate: SalesInvoiceIssueDateSchema,
    issuedAt: z.string().datetime(),
  }).strict(),
]);

export const CreateSalesCreditNoteRequestSchema = z.object({ reason: optionalReason }).strict();
export const UpdateSalesCreditNoteRequestSchema = z.object({
  expectedVersion: z.number().int().positive(),
  reason: z.string().trim().min(1).max(1000).nullable(),
}).strict();
export const AddSalesCreditNoteLineRequestSchema = z.object({
  expectedVersion: z.number().int().positive(),
  originalInvoiceLineId: z.string().trim().min(1).max(200),
  quantity: SalesInvoiceQuantitySchema,
}).strict();
export const UpdateSalesCreditNoteLineRequestSchema = z.object({
  expectedVersion: z.number().int().positive(),
  quantity: SalesInvoiceQuantitySchema,
}).strict();
export const RemoveSalesCreditNoteLineRequestSchema = z.object({
  expectedVersion: z.coerce.number().int().positive(),
}).strict();
export const IssueSalesCreditNoteRequestSchema = z.object({
  expectedCreditNoteVersion: z.number().int().positive(),
  expectedReceivableVersion: z.number().int().min(0),
  clientRequestId: z.string().uuid(),
  issueDate: SalesInvoiceIssueDateSchema,
}).strict();
export const IssueSalesCreditNoteResponseSchema = z.object({
  creditNote: SalesIssuedCreditNoteSchema,
  receivable: SalesInvoiceReceivableSchema,
}).strict();
export const SalesCreditNoteIdRequestSchema = z.object({
  invoiceId: z.string().trim().min(1).max(200),
  creditNoteId: z.string().trim().min(1).max(200),
}).strict();
export const SalesCreditNoteLineIdRequestSchema = SalesCreditNoteIdRequestSchema.extend({
  lineId: z.string().trim().min(1).max(200),
}).strict();
export const ListSalesCreditNotesRequestSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50).optional(),
  cursor: z.string().min(1).optional(),
}).strict();
export const SalesCreditNoteListResponseSchema = z.object({
  items: z.array(SalesCreditNoteSummarySchema),
  nextCursor: z.string().min(1).optional(),
}).strict();

export type SalesCreditNote = z.infer<typeof SalesCreditNoteSchema>;
export type SalesDraftCreditNote = z.infer<typeof SalesDraftCreditNoteSchema>;
export type SalesIssuedCreditNote = z.infer<typeof SalesIssuedCreditNoteSchema>;
export type SalesCreditNoteLine = z.infer<typeof SalesCreditNoteLineSchema>;
export type SalesCreditNoteSummary = z.infer<typeof SalesCreditNoteSummarySchema>;
export type CreateSalesCreditNoteRequest = z.infer<typeof CreateSalesCreditNoteRequestSchema>;
export type UpdateSalesCreditNoteRequest = z.infer<typeof UpdateSalesCreditNoteRequestSchema>;
export type AddSalesCreditNoteLineRequest = z.infer<typeof AddSalesCreditNoteLineRequestSchema>;
export type UpdateSalesCreditNoteLineRequest = z.infer<typeof UpdateSalesCreditNoteLineRequestSchema>;
export type IssueSalesCreditNoteRequest = z.infer<typeof IssueSalesCreditNoteRequestSchema>;
export type IssueSalesCreditNoteResponse = z.infer<typeof IssueSalesCreditNoteResponseSchema>;
export type SalesCreditNoteListResponse = z.infer<typeof SalesCreditNoteListResponseSchema>;
