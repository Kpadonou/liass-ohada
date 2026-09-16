import { ListSalesCreditNotesRequestSchema, SalesInvoiceIdRequestSchema } from "@liass-ohada/shared/sales";
import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { SalesCreditNoteService } from "./sales-credit-note-service";
const Schema = ListSalesCreditNotesRequestSchema.extend({ invoiceId: SalesInvoiceIdRequestSchema.shape.invoiceId }).strict();
export const handler = createHandler(Schema, async ({ invoiceId, ...request }, { orgId, i18n }) => ({
  message: i18n.getMessage("SUCCESS_SALES_CREDIT_NOTES_RETRIEVED"),
  data: await SalesCreditNoteService.list(orgId, invoiceId, request),
}), { action: "GET /sales/invoices/{invoiceId}/credit-notes", permission: "SALES_READ", productCode: "SALES" });
