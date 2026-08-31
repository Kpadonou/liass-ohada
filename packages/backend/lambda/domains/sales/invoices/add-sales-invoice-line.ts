import {
  AddSalesInvoiceLineRequestSchema,
  SalesInvoiceIdRequestSchema,
} from "@liass-ohada/shared/sales";
import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { SalesInvoiceService } from "./sales-invoice-service";

export const AddSalesInvoiceLineRouteSchema =
  AddSalesInvoiceLineRequestSchema.safeExtend({
    invoiceId: SalesInvoiceIdRequestSchema.shape.invoiceId,
  });

export const handler = createHandler(
  AddSalesInvoiceLineRouteSchema,
  async ({ invoiceId, ...request }, { orgId, userId, i18n }) => ({
    message: i18n.getMessage("SUCCESS_SALES_INVOICE_LINE_ADDED"),
    data: await SalesInvoiceService.addLine(orgId, userId, invoiceId, request),
  }),
  {
    action: "POST /sales/invoices/{invoiceId}/lines",
    permission: "SALES_WRITE",
    productCode: "SALES",
  },
);
