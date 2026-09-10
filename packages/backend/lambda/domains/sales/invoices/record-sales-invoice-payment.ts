import {
  RecordSalesPaymentRequestSchema,
  SalesInvoiceIdRequestSchema,
} from "@liass-ohada/shared/sales";
import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { SalesPaymentService } from "./sales-payment-service";

export const RecordSalesInvoicePaymentRouteSchema =
  RecordSalesPaymentRequestSchema.extend({
    invoiceId: SalesInvoiceIdRequestSchema.shape.invoiceId,
  }).strict();

export const handler = createHandler(
  RecordSalesInvoicePaymentRouteSchema,
  async ({ invoiceId, ...request }, { orgId, userId, i18n }) => ({
    message: i18n.getMessage("SUCCESS_SALES_PAYMENT_RECORDED"),
    data: await SalesPaymentService.record(orgId, userId, invoiceId, request),
  }),
  {
    action: "POST /sales/invoices/{invoiceId}/payments",
    permission: "SALES_WRITE",
    productCode: "SALES",
  },
);
