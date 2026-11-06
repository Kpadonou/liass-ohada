import { publicSalesResponse } from "./public-sales-response";
import {
  SalesCreditNoteLineIdRequestSchema,
  UpdateSalesCreditNoteLineRequestSchema,
} from "@liass-ohada/shared/sales";
import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { SalesCreditNoteService } from "./sales-credit-note-service";
const Schema = UpdateSalesCreditNoteLineRequestSchema.extend({
  invoiceId: SalesCreditNoteLineIdRequestSchema.shape.invoiceId,
  creditNoteId: SalesCreditNoteLineIdRequestSchema.shape.creditNoteId,
  lineId: SalesCreditNoteLineIdRequestSchema.shape.lineId,
}).strict();
export const handler = createHandler(
  Schema,
  async (
    { invoiceId, creditNoteId, lineId, ...request },
    { orgId, userId, i18n },
  ) => ({
    message: i18n.getMessage("SUCCESS_SALES_CREDIT_NOTE_LINE_UPDATED"),
    data: publicSalesResponse(
      await SalesCreditNoteService.updateLine(
        orgId,
        userId,
        invoiceId,
        creditNoteId,
        lineId,
        request,
      ),
    ),
  }),
  {
    action:
      "PATCH /sales/invoices/{invoiceId}/credit-notes/{creditNoteId}/lines/{lineId}",
    permission: "SALES_WRITE",
    productCode: "SALES",
  },
);
