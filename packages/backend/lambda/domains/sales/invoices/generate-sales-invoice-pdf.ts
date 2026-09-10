import { SalesInvoiceIdRequestSchema } from "@liass-ohada/shared/sales";
import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { SalesInvoiceDocumentService } from "./sales-invoice-document-service";

export const handler = createHandler(
  SalesInvoiceIdRequestSchema,
  async ({ invoiceId }, { orgId, userId, i18n }) => ({
    message: i18n.getMessage("SUCCESS_SALES_INVOICE_DOCUMENT_GENERATED"),
    data: await SalesInvoiceDocumentService.generate(orgId, userId, invoiceId),
  }),
  {
    action: "POST /sales/invoices/{invoiceId}/documents/pdf",
    permission: "SALES_WRITE",
    productCode: "SALES",
  },
);
