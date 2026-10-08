import { createHash } from "node:crypto";
import { z } from "zod";
import { SalesFiscalizableDocumentSchema, SalesFiscalizableDocument } from "@liass-ohada/shared/sales";
import { AppError } from "@/lambda/shared/app-error";
import { SalesInvoiceRepository } from "../invoices/sales-invoice-repository";
import { SalesCreditNoteRepository } from "../invoices/sales-credit-note-repository";
import { SalesInvoiceCalculator } from "../invoices/sales-invoice-calculator";

const inputSchema = z.object({ orgId: z.string().min(1).max(200), sourceDocumentId: z.string().min(1).max(200),
  sourceDocumentType: z.enum(["INVOICE", "CREDIT_NOTE"]), originalInvoiceId: z.string().min(1).max(200).optional() }).strict()
  .refine(v => v.sourceDocumentType === "CREDIT_NOTE" ? !!v.originalInvoiceId : !v.originalInvoiceId);

/** SALES-owned application boundary. Caller supplies the platform-verified effective organization. */
export class SalesFiscalSourceService {
  static async getIssuedDocument(input: z.infer<typeof inputSchema>): Promise<SalesFiscalizableDocument> {
    const parsed = inputSchema.parse(input);
    const document = parsed.sourceDocumentType === "INVOICE"
      ? await SalesInvoiceRepository.get(parsed.orgId, parsed.sourceDocumentId)
      : await SalesCreditNoteRepository.get(parsed.orgId, parsed.originalInvoiceId!, parsed.sourceDocumentId);
    if (!document) throw new AppError(404, "FISCAL_SOURCE_NOT_FOUND");
    if (document.status !== "ISSUED") throw new AppError(409, "FISCAL_SOURCE_NOT_ISSUED");
    const toMinor = (amount: string) => SalesInvoiceCalculator.toMinorUnits(document.currency, amount);
    const facts = {
      protocolVersion: 1, orgId: parsed.orgId, sourceDocumentType: parsed.sourceDocumentType,
      sourceDocumentId: document.id, sourceVersion: document.version,
      commercialNumber: "invoiceNumber" in document ? document.invoiceNumber : document.creditNoteNumber,
      issueDate: document.issueDate, issuedAt: document.issuedAt, currency: document.currency,
      customerSnapshot: document.customerSnapshot,
      lines: [...document.lines].sort((a, b) => a.position - b.position).map(({ subtotal, taxAmount, total, ...line }) => ({
        ...line, subtotalMinor: toMinor(subtotal), taxAmountMinor: toMinor(taxAmount), totalMinor: toMinor(total),
      })),
      subtotalMinor: toMinor(document.subtotal), taxTotalMinor: toMinor(document.taxTotal), totalMinor: toMinor(document.total),
      ...("originalInvoiceId" in document ? { originalInvoiceId: document.originalInvoiceId,
        originalInvoiceNumber: document.originalInvoiceNumber, reason: document.reason } : {}),
    };
    const sourceDigest = createHash("sha256").update(JSON.stringify(facts)).digest("hex");
    return SalesFiscalizableDocumentSchema.parse({ ...facts, sourceDigest });
  }
}
