import { IssueSalesCreditNoteRequestSchema, SalesCreditNoteIdRequestSchema } from "@liass-ohada/shared/sales";
import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { SalesCreditNoteService } from "./sales-credit-note-service";
const Schema = IssueSalesCreditNoteRequestSchema.extend({
  invoiceId: SalesCreditNoteIdRequestSchema.shape.invoiceId,
  creditNoteId: SalesCreditNoteIdRequestSchema.shape.creditNoteId,
}).strict();
export const handler = createHandler(Schema, async ({ invoiceId, creditNoteId, ...request }, { orgId, userId, i18n }) => ({
  message: i18n.getMessage("SUCCESS_SALES_CREDIT_NOTE_ISSUED"),
  data: await SalesCreditNoteService.issue(orgId, userId, invoiceId, creditNoteId, request),
}), { action: "POST /sales/invoices/{invoiceId}/credit-notes/{creditNoteId}/issue", permission: "SALES_WRITE", productCode: "SALES" });
