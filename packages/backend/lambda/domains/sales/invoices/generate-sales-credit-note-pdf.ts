import { SalesCreditNoteIdRequestSchema } from "@liass-ohada/shared/sales";
import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { SalesCreditNoteDocumentService } from "./sales-credit-note-document-service";

export const handler = createHandler(
  SalesCreditNoteIdRequestSchema,
  async ({ invoiceId, creditNoteId }, { orgId, userId, i18n }) => ({
    message: i18n.getMessage("SUCCESS_SALES_CREDIT_NOTE_DOCUMENT_GENERATED"),
    data: await SalesCreditNoteDocumentService.generate(
      orgId,
      userId,
      invoiceId,
      creditNoteId,
    ),
  }),
  {
    action:
      "POST /sales/invoices/{invoiceId}/credit-notes/{creditNoteId}/documents/pdf",
    permission: "SALES_WRITE",
    productCode: "SALES",
  },
);
