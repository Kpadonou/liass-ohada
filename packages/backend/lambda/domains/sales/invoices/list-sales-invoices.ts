import { ListSalesInvoicesRequestSchema } from "@liass-ohada/shared/sales";
import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { SalesInvoiceService } from "./sales-invoice-service";

export const handler = createHandler(
  ListSalesInvoicesRequestSchema,
  async (data, { orgId, i18n }) => ({
    message: i18n.getMessage("SUCCESS_SALES_INVOICES_RETRIEVED"),
    data: await SalesInvoiceService.list(orgId, data),
  }),
  {
    action: "GET /sales/invoices",
    permission: "SALES_READ",
    productCode: "SALES",
  },
);
