import { SalesInvoiceIdRequestSchema } from "@liass-ohada/shared/sales";
import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { SalesPaymentService } from "./sales-payment-service";

export const handler = createHandler(
  SalesInvoiceIdRequestSchema,
  async ({ invoiceId }, { orgId, i18n }) => ({
    message: i18n.getMessage("SUCCESS_SALES_RECEIVABLE_RETRIEVED"),
    data: await SalesPaymentService.getReceivable(orgId, invoiceId),
  }),
  {
    action: "GET /sales/invoices/{invoiceId}/receivable",
    permission: "SALES_READ",
    productCode: "SALES",
  },
);
