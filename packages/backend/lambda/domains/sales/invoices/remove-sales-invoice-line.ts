import {
  RemoveSalesInvoiceLineRequestSchema,
  SalesInvoiceLineIdRequestSchema,
} from "@liass-ohada/shared/sales";
import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { SalesInvoiceService } from "./sales-invoice-service";

export const RemoveSalesInvoiceLineRouteSchema =
  RemoveSalesInvoiceLineRequestSchema.extend({
    invoiceId: SalesInvoiceLineIdRequestSchema.shape.invoiceId,
    lineId: SalesInvoiceLineIdRequestSchema.shape.lineId,
  }).strict();

export const handler = createHandler(
  RemoveSalesInvoiceLineRouteSchema,
  async ({ invoiceId, lineId, expectedVersion }, { orgId, userId, i18n }) => ({
    message: i18n.getMessage("SUCCESS_SALES_INVOICE_LINE_REMOVED"),
    data: await SalesInvoiceService.removeLine(
      orgId,
      userId,
      invoiceId,
      lineId,
      expectedVersion,
    ),
  }),
  {
    action: "DELETE /sales/invoices/{invoiceId}/lines/{lineId}",
    permission: "SALES_WRITE",
    productCode: "SALES",
  },
);
