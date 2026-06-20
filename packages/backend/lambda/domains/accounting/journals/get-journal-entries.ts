import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { JournalService } from "@/lambda/shared/services/journal-service";
import {
  JournalSpecificBookQuerySchema,
} from "@liass-ohada/shared/accounting";

export const handler = createHandler(
  JournalSpecificBookQuerySchema,
  async (data, { orgId, i18n }) => {
    const result = await JournalService.getJournalEntries(orgId, data);

    return {
      message: i18n.getMessage("SUCCESS_JOURNAL_RETRIEVED"),
      data: {
        meta: {
          year: data.year,
          journalCode: data.journalCode.toUpperCase(),
          month: data.month,
        },
        ...result,
      },
    };
  },
);
