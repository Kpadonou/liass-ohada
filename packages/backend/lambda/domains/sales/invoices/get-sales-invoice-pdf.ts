import { SalesInvoiceIdRequestSchema } from "@liass-ohada/shared/sales";
import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { SalesInvoiceDocumentService } from "./sales-invoice-document-service";

export const handler = createHandler(
  SalesInvoiceIdRequestSchema,
  async ({ invoiceId }, { orgId, i18n }) => ({
    message: i18n.getMessage("SUCCESS_SALES_INVOICE_DOCUMENT_RETRIEVED"),
    data: await SalesInvoiceDocumentService.getMetadata(orgId, invoiceId),
  }),
  {
    action: "GET /sales/invoices/{invoiceId}/documents/pdf",
    permission: "SALES_READ",
    productCode: "SALES",
  },
);
