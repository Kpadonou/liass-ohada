import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import {
  JournalEntriesRequestSchema,
  JournalService,
} from "@/lambda/shared/services/journal-service";

export const handler = createHandler(
  JournalEntriesRequestSchema,
  async (data, { orgId, i18n }) => {
    const entries = await JournalService.getJournalEntries(orgId, data);

    return {
      message: i18n.getMessage("SUCCESS_JOURNAL_RETRIEVED"),
      data: {
        meta: {
          year: data.year,
          journalCode: data.journalCode || "ALL",
          month: data.month || "ALL",
        },
        entries,
      },
    };
  },
);
