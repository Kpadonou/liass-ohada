import {
  IssueSalesInvoiceRequestSchema,
  SalesInvoiceIdRequestSchema,
} from "@liass-ohada/shared/sales";
import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { SalesInvoiceService } from "./sales-invoice-service";

export const IssueSalesInvoiceRouteSchema =
  IssueSalesInvoiceRequestSchema.extend({
    invoiceId: SalesInvoiceIdRequestSchema.shape.invoiceId,
  }).strict();

export const handler = createHandler(
  IssueSalesInvoiceRouteSchema,
  async ({ invoiceId, ...request }, { orgId, userId, i18n }) => ({
    message: i18n.getMessage("SUCCESS_SALES_INVOICE_ISSUED"),
    data: await SalesInvoiceService.issue(orgId, userId, invoiceId, request),
  }),
  {
    action: "POST /sales/invoices/{invoiceId}/issue",
    permission: "SALES_WRITE",
    productCode: "SALES",
  },
);
