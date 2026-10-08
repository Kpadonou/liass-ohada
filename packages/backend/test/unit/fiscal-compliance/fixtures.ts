import { randomUUID } from "node:crypto";
import { SalesFiscalizableDocumentSchema } from "@liass-ohada/shared/sales";
import { PrepareFiscalCertificationRequestSchema } from "@liass-ohada/shared/fiscal-compliance";
export const timestamp = "2026-10-08T10:00:00.000Z";
export const commercialInvoice = {
  id: "invoice-1", status: "ISSUED" as const, currency: "EUR", customerId: "customer-1",
  customerSnapshot: { name: "Frozen buyer", taxIdentifier: "UNCLASSIFIED-TAX-ID" }, invoiceNumber: "19",
  issueDate: "2026-10-08", issuedAt: timestamp, version: 2, createdAt: timestamp, updatedAt: timestamp,
  lines: [{ id: "line-1", position: 1, description: "Service", quantity: "2.5", unitPrice: "10.01", taxRate: "18",
    subtotal: "25.03", taxAmount: "4.51", total: "29.54", createdAt: timestamp, updatedAt: timestamp }],
  lineCount: 1, subtotal: "25.03", taxTotal: "4.51", total: "29.54",
};
export const source = () => SalesFiscalizableDocumentSchema.parse({
  protocolVersion: 1, orgId: "org-1", sourceDocumentId: "invoice-1", sourceDocumentType: "INVOICE", sourceVersion: 2,
  sourceDigest: "a".repeat(64), commercialNumber: "19", issueDate: "2026-10-08", issuedAt: timestamp,
  currency: "EUR", customerSnapshot: commercialInvoice.customerSnapshot, subtotalMinor: "2503", taxTotalMinor: "451", totalMinor: "2954",
  lines: commercialInvoice.lines.map(({ subtotal, taxAmount, total, ...line }) => ({ ...line, subtotalMinor: "2503", taxAmountMinor: "451", totalMinor: "2954" })),
});
export const request = () => PrepareFiscalCertificationRequestSchema.parse({
  environment: "TEST", sourceDocumentType: "INVOICE", sourceDocumentId: "invoice-1", clientRequestId: randomUUID(),
  preparation: { lines: [] },
});
