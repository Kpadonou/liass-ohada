import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import {
  CreateJournalInputSchema,
  JournalService,
} from "@/lambda/shared/services/journal-service";

export const handler = createHandler(
  CreateJournalInputSchema,
  async (data, { orgId, userId, i18n }) => {
    const journal = await JournalService.createJournal(orgId, userId, data);

    return {
      message: i18n.getMessage("JOURNAL_CREATED"),
      data: journal,
    };
  },
  {
    action: "POST /journals",
    permission: "ACCOUNTING_WRITE",
    productCode: "ACCOUNTING",
  },
);
