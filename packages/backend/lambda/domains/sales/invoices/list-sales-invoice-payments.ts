import {
  ListSalesPaymentsRequestSchema,
  SalesInvoiceIdRequestSchema,
} from "@liass-ohada/shared/sales";
import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { SalesPaymentService } from "./sales-payment-service";

export const ListSalesInvoicePaymentsRouteSchema =
  ListSalesPaymentsRequestSchema.extend({
    invoiceId: SalesInvoiceIdRequestSchema.shape.invoiceId,
  }).strict();

export const handler = createHandler(
  ListSalesInvoicePaymentsRouteSchema,
  async ({ invoiceId, ...request }, { orgId, i18n }) => ({
    message: i18n.getMessage("SUCCESS_SALES_PAYMENTS_RETRIEVED"),
    data: await SalesPaymentService.listPayments(orgId, invoiceId, request),
  }),
  {
    action: "GET /sales/invoices/{invoiceId}/payments",
    permission: "SALES_READ",
    productCode: "SALES",
  },
);
