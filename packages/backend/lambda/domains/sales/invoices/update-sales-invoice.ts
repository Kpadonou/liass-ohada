import {
  SalesInvoiceIdRequestSchema,
  UpdateSalesInvoiceRequestSchema,
} from "@liass-ohada/shared/sales";
import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { SalesInvoiceService } from "./sales-invoice-service";

export const UpdateSalesInvoiceRouteSchema =
  UpdateSalesInvoiceRequestSchema.safeExtend({
    invoiceId: SalesInvoiceIdRequestSchema.shape.invoiceId,
  }).refine(
    (request) =>
      Object.keys(request).some(
        (field) => field !== "expectedVersion" && field !== "invoiceId",
      ),
    { message: "At least one invoice field is required" },
  );

export const handler = createHandler(
  UpdateSalesInvoiceRouteSchema,
  async ({ invoiceId, ...request }, { orgId, userId, i18n }) => ({
    message: i18n.getMessage("SUCCESS_SALES_INVOICE_UPDATED"),
    data: await SalesInvoiceService.update(orgId, userId, invoiceId, request),
  }),
  {
    action: "PATCH /sales/invoices/{invoiceId}",
    permission: "SALES_WRITE",
    productCode: "SALES",
  },
);
