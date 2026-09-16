import { z } from "zod";

export const SalesCreditNoteDocumentTypeSchema = z.literal("CREDIT_NOTE_PDF");

export const SalesCreditNoteRenderingVersionSchema = z
  .string()
  .regex(/^[1-9]\d*$/);

export const SalesCreditNoteDocumentContentHashSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/);

export const SalesCreditNoteDocumentSchema = z
  .object({
    status: z.literal("AVAILABLE"),
    creditNoteId: z.string().min(1),
    documentType: SalesCreditNoteDocumentTypeSchema,
    renderingVersion: SalesCreditNoteRenderingVersionSchema,
    contentHash: SalesCreditNoteDocumentContentHashSchema,
    contentType: z.literal("application/pdf"),
    sizeBytes: z.number().int().positive(),
    generatedAt: z.string().datetime(),
  })
  .strict();

export const SalesCreditNoteDocumentResponseSchema = z
  .object({
    data: SalesCreditNoteDocumentSchema,
    message: z.unknown().optional(),
  })
  .strict();

export const SalesCreditNoteDownloadUrlSchema = z
  .object({
    url: z.string().url(),
    expiresAt: z.string().datetime(),
  })
  .strict();

export const SalesCreditNoteDownloadUrlResponseSchema = z
  .object({
    data: SalesCreditNoteDownloadUrlSchema,
    message: z.unknown().optional(),
  })
  .strict();

export type SalesCreditNoteDocumentType = z.infer<
  typeof SalesCreditNoteDocumentTypeSchema
>;
export type SalesCreditNoteDocument = z.infer<
  typeof SalesCreditNoteDocumentSchema
>;
export type SalesCreditNoteDownloadUrl = z.infer<
  typeof SalesCreditNoteDownloadUrlSchema
>;
