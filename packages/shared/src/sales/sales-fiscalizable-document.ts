import { z } from "zod";
import { SalesInvoiceCustomerSnapshotSchema, SalesInvoiceLineSchema } from "./sales-invoice";
import { SalesCreditNoteLineSchema } from "./sales-credit-note";

const minor = z.string().max(80).regex(/^(0|[1-9]\d*)$/);
const amounts = { subtotalMinor: minor, taxAmountMinor: minor, totalMinor: minor };
const invoiceLine = SalesInvoiceLineSchema.omit({ subtotal: true, taxAmount: true, total: true }).extend(amounts).strict();
const creditLine = SalesCreditNoteLineSchema.omit({ subtotal: true, taxAmount: true, total: true }).extend(amounts).strict();
const header = {
  protocolVersion: z.literal(1), orgId: z.string().min(1).max(200),
  sourceDocumentId: z.string().min(1).max(200), sourceVersion: z.number().int().positive(),
  sourceDigest: z.string().regex(/^[a-f0-9]{64}$/), commercialNumber: z.string().min(1).max(200),
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), issuedAt: z.string().datetime(),
  currency: z.string().regex(/^[A-Z]{3}$/), customerSnapshot: SalesInvoiceCustomerSnapshotSchema.optional(),
  subtotalMinor: minor, taxTotalMinor: minor, totalMinor: minor,
};
/** SALES-owned, versioned read contract. Amounts are exact smallest-currency-unit integers. */
export const SalesFiscalizableDocumentSchema = z.discriminatedUnion("sourceDocumentType", [
  z.object({ ...header, sourceDocumentType: z.literal("INVOICE"), lines: z.array(invoiceLine).min(1).max(100) }).strict(),
  z.object({ ...header, sourceDocumentType: z.literal("CREDIT_NOTE"), originalInvoiceId: z.string().min(1).max(200),
    originalInvoiceNumber: z.string().min(1).max(200), reason: z.string().min(1).max(1000),
    lines: z.array(creditLine).min(1).max(100) }).strict(),
]);
export type SalesFiscalizableDocument = z.infer<typeof SalesFiscalizableDocumentSchema>;
