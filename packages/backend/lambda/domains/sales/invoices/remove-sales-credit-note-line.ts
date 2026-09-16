import { RemoveSalesCreditNoteLineRequestSchema, SalesCreditNoteLineIdRequestSchema } from "@liass-ohada/shared/sales";
import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { SalesCreditNoteService } from "./sales-credit-note-service";
const Schema = RemoveSalesCreditNoteLineRequestSchema.extend({
  invoiceId: SalesCreditNoteLineIdRequestSchema.shape.invoiceId,
  creditNoteId: SalesCreditNoteLineIdRequestSchema.shape.creditNoteId,
  lineId: SalesCreditNoteLineIdRequestSchema.shape.lineId,
}).strict();
export const handler = createHandler(Schema, async ({ invoiceId, creditNoteId, lineId, expectedVersion }, { orgId, userId, i18n }) => ({
  message: i18n.getMessage("SUCCESS_SALES_CREDIT_NOTE_LINE_REMOVED"),
  data: await SalesCreditNoteService.removeLine(orgId, userId, invoiceId, creditNoteId, lineId, expectedVersion),
}), { action: "DELETE /sales/invoices/{invoiceId}/credit-notes/{creditNoteId}/lines/{lineId}", permission: "SALES_WRITE", productCode: "SALES" });
