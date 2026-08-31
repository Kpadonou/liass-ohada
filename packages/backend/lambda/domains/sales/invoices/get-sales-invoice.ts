import { SalesInvoiceIdRequestSchema } from "@liass-ohada/shared/sales";
import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { SalesInvoiceService } from "./sales-invoice-service";

export const handler = createHandler(
  SalesInvoiceIdRequestSchema,
  async ({ invoiceId }, { orgId, i18n }) => ({
    message: i18n.getMessage("SUCCESS_SALES_INVOICE_RETRIEVED"),
    data: await SalesInvoiceService.get(orgId, invoiceId),
  }),
  {
    action: "GET /sales/invoices/{invoiceId}",
    permission: "SALES_READ",
    productCode: "SALES",
  },
);
