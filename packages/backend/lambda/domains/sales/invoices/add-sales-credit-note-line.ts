import { AddSalesCreditNoteLineRequestSchema, SalesCreditNoteIdRequestSchema } from "@liass-ohada/shared/sales";
import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { SalesCreditNoteService } from "./sales-credit-note-service";
const Schema = AddSalesCreditNoteLineRequestSchema.extend({
  invoiceId: SalesCreditNoteIdRequestSchema.shape.invoiceId,
  creditNoteId: SalesCreditNoteIdRequestSchema.shape.creditNoteId,
}).strict();
export const handler = createHandler(Schema, async ({ invoiceId, creditNoteId, ...request }, { orgId, userId, i18n }) => ({
  message: i18n.getMessage("SUCCESS_SALES_CREDIT_NOTE_LINE_ADDED"),
  data: await SalesCreditNoteService.addLine(orgId, userId, invoiceId, creditNoteId, request),
}), { action: "POST /sales/invoices/{invoiceId}/credit-notes/{creditNoteId}/lines", permission: "SALES_WRITE", productCode: "SALES" });
