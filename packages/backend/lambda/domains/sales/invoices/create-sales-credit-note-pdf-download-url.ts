import { SalesCreditNoteIdRequestSchema } from "@liass-ohada/shared/sales";
import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { SalesCreditNoteDocumentService } from "./sales-credit-note-document-service";

export const handler = createHandler(
  SalesCreditNoteIdRequestSchema,
  async ({ invoiceId, creditNoteId }, { orgId, i18n }) => ({
    message: i18n.getMessage("SUCCESS_SALES_CREDIT_NOTE_DOWNLOAD_URL_CREATED"),
    data: await SalesCreditNoteDocumentService.createDownloadUrl(
      orgId,
      invoiceId,
      creditNoteId,
    ),
  }),
  {
    action:
      "POST /sales/invoices/{invoiceId}/credit-notes/{creditNoteId}/documents/pdf/download-url",
    permission: "SALES_READ",
    productCode: "SALES",
  },
);
