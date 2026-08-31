import {
  SalesInvoiceLineIdRequestSchema,
  UpdateSalesInvoiceLineRequestSchema,
} from "@liass-ohada/shared/sales";
import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { SalesInvoiceService } from "./sales-invoice-service";

export const UpdateSalesInvoiceLineRouteSchema =
  UpdateSalesInvoiceLineRequestSchema.safeExtend({
    invoiceId: SalesInvoiceLineIdRequestSchema.shape.invoiceId,
    lineId: SalesInvoiceLineIdRequestSchema.shape.lineId,
  }).refine(
    (request) =>
      Object.keys(request).some(
        (field) =>
          field !== "expectedVersion" &&
          field !== "invoiceId" &&
          field !== "lineId",
      ),
    { message: "At least one invoice line field is required" },
  );

export const handler = createHandler(
  UpdateSalesInvoiceLineRouteSchema,
  async ({ invoiceId, lineId, ...request }, { orgId, userId, i18n }) => ({
    message: i18n.getMessage("SUCCESS_SALES_INVOICE_LINE_UPDATED"),
    data: await SalesInvoiceService.updateLine(
      orgId,
      userId,
      invoiceId,
      lineId,
      request,
    ),
  }),
  {
    action: "PATCH /sales/invoices/{invoiceId}/lines/{lineId}",
    permission: "SALES_WRITE",
    productCode: "SALES",
  },
);
