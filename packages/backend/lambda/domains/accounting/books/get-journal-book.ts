import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { JournalBookService } from "@/lambda/shared/services/journal-book-service";
import {
  JournalBookQuerySchema,
  JournalBookResponseSchema,
} from "@liass-ohada/shared/accounting";

export const handler = createHandler(
  JournalBookQuerySchema,
  async (data, { orgId, i18n }) =>
    JournalBookResponseSchema.parse({
      message: i18n.getMessage("SUCCESS_JOURNAL_RETRIEVED"),
      data: {
        meta: {
          year: data.year,
          startDate: data.startDate,
          endDate: data.endDate,
          journalCode: data.journalCode?.toUpperCase(),
        },
        ...(await JournalBookService.getJournalBook(orgId, data)),
      },
    }),
  {
    action: "GET /books/journal-book",
    permission: "ACCOUNTING_READ",
    productCode: "ACCOUNTING",
  },
);
