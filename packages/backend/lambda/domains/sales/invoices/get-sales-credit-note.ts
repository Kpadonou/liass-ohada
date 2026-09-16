import { SalesCreditNoteIdRequestSchema } from "@liass-ohada/shared/sales";
import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { SalesCreditNoteService } from "./sales-credit-note-service";
export const handler = createHandler(SalesCreditNoteIdRequestSchema, async ({ invoiceId, creditNoteId }, { orgId, i18n }) => ({
  message: i18n.getMessage("SUCCESS_SALES_CREDIT_NOTE_RETRIEVED"),
  data: await SalesCreditNoteService.get(orgId, invoiceId, creditNoteId),
}), { action: "GET /sales/invoices/{invoiceId}/credit-notes/{creditNoteId}", permission: "SALES_READ", productCode: "SALES" });
