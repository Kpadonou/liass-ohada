import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import {
  JournalService,
  UpdateJournalInputSchema,
} from "@/lambda/shared/services/journal-service";

export const handler = createHandler(
  UpdateJournalInputSchema,
  async (data, { orgId, userId, i18n }) => {
    const journal = await JournalService.updateJournal(orgId, userId, data);

    return {
      message: i18n.getMessage("JOURNAL_UPDATED"),
      data: journal,
    };
  },
);
