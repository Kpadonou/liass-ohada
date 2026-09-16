import { SalesCreditNoteIdRequestSchema } from "@liass-ohada/shared/sales";
import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { SalesCreditNoteDocumentService } from "./sales-credit-note-document-service";

export const handler = createHandler(
  SalesCreditNoteIdRequestSchema,
  async ({ invoiceId, creditNoteId }, { orgId, i18n }) => ({
    message: i18n.getMessage("SUCCESS_SALES_CREDIT_NOTE_DOCUMENT_RETRIEVED"),
    data: await SalesCreditNoteDocumentService.getMetadata(
      orgId,
      invoiceId,
      creditNoteId,
    ),
  }),
  {
    action:
      "GET /sales/invoices/{invoiceId}/credit-notes/{creditNoteId}/documents/pdf",
    permission: "SALES_READ",
    productCode: "SALES",
  },
);
