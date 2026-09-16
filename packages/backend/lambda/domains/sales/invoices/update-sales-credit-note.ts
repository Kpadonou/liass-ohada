import { SalesCreditNoteIdRequestSchema, UpdateSalesCreditNoteRequestSchema } from "@liass-ohada/shared/sales";
import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { SalesCreditNoteService } from "./sales-credit-note-service";
const Schema = UpdateSalesCreditNoteRequestSchema.extend({
  invoiceId: SalesCreditNoteIdRequestSchema.shape.invoiceId,
  creditNoteId: SalesCreditNoteIdRequestSchema.shape.creditNoteId,
}).strict();
export const handler = createHandler(Schema, async ({ invoiceId, creditNoteId, ...request }, { orgId, userId, i18n }) => ({
  message: i18n.getMessage("SUCCESS_SALES_CREDIT_NOTE_UPDATED"),
  data: await SalesCreditNoteService.update(orgId, userId, invoiceId, creditNoteId, request),
}), { action: "PATCH /sales/invoices/{invoiceId}/credit-notes/{creditNoteId}", permission: "SALES_WRITE", productCode: "SALES" });
