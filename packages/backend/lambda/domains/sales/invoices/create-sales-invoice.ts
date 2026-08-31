import { CreateSalesInvoiceRequestSchema } from "@liass-ohada/shared/sales";
import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { SalesInvoiceService } from "./sales-invoice-service";

export const handler = createHandler(
  CreateSalesInvoiceRequestSchema,
  async (data, { orgId, userId, i18n }) => ({
    message: i18n.getMessage("SUCCESS_SALES_INVOICE_CREATED"),
    data: await SalesInvoiceService.create(orgId, userId, data),
  }),
  {
    action: "POST /sales/invoices",
    permission: "SALES_WRITE",
    productCode: "SALES",
  },
);
