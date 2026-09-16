import { CreateSalesCreditNoteRequestSchema, SalesInvoiceIdRequestSchema } from "@liass-ohada/shared/sales";
import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { SalesCreditNoteService } from "./sales-credit-note-service";
const Schema = CreateSalesCreditNoteRequestSchema.extend({ invoiceId: SalesInvoiceIdRequestSchema.shape.invoiceId }).strict();
export const handler = createHandler(Schema, async ({ invoiceId, ...request }, { orgId, userId, i18n }) => ({
  message: i18n.getMessage("SUCCESS_SALES_CREDIT_NOTE_CREATED"),
  data: await SalesCreditNoteService.create(orgId, userId, invoiceId, request),
}), { action: "POST /sales/invoices/{invoiceId}/credit-notes", permission: "SALES_WRITE", productCode: "SALES" });
