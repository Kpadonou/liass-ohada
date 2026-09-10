import { SalesInvoiceIdRequestSchema } from "@liass-ohada/shared/sales";
import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { SalesInvoiceDocumentService } from "./sales-invoice-document-service";

export const handler = createHandler(
  SalesInvoiceIdRequestSchema,
  async ({ invoiceId }, { orgId, i18n }) => ({
    message: i18n.getMessage("SUCCESS_SALES_INVOICE_DOWNLOAD_URL_CREATED"),
    data: await SalesInvoiceDocumentService.createDownloadUrl(orgId, invoiceId),
  }),
  {
    action: "POST /sales/invoices/{invoiceId}/documents/pdf/download-url",
    permission: "SALES_READ",
    productCode: "SALES",
  },
);
