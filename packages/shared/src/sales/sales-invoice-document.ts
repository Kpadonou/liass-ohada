import { z } from "zod";

export const SalesInvoiceDocumentTypeSchema = z.literal("INVOICE_PDF");

export const SalesInvoiceRenderingVersionSchema = z
  .string()
  .regex(/^[1-9]\d*$/);

export const SalesInvoiceDocumentContentHashSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/);

export const SalesInvoiceDocumentSchema = z
  .object({
    status: z.literal("AVAILABLE"),
    invoiceId: z.string().min(1),
    documentType: SalesInvoiceDocumentTypeSchema,
    renderingVersion: SalesInvoiceRenderingVersionSchema,
    contentHash: SalesInvoiceDocumentContentHashSchema,
    contentType: z.literal("application/pdf"),
    sizeBytes: z.number().int().positive(),
    generatedAt: z.string().datetime(),
  })
  .strict();

export const SalesInvoiceDocumentResponseSchema = z
  .object({
    data: SalesInvoiceDocumentSchema,
    message: z.unknown().optional(),
  })
  .strict();

export const SalesInvoiceDownloadUrlSchema = z
  .object({
    url: z.string().url(),
    expiresAt: z.string().datetime(),
  })
  .strict();

export const SalesInvoiceDownloadUrlResponseSchema = z
  .object({
    data: SalesInvoiceDownloadUrlSchema,
    message: z.unknown().optional(),
  })
  .strict();

export type SalesInvoiceDocumentType = z.infer<
  typeof SalesInvoiceDocumentTypeSchema
>;
export type SalesInvoiceDocument = z.infer<
  typeof SalesInvoiceDocumentSchema
>;
export type SalesInvoiceDownloadUrl = z.infer<
  typeof SalesInvoiceDownloadUrlSchema
>;
