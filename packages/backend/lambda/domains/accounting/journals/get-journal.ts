import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { JournalService } from "@/lambda/shared/services/journal-service";
import { z } from "zod";

const GetJournalSchema = z.object({
  journalCode: z.string().min(1),
});

export const handler = createHandler(
  GetJournalSchema,
  async (data, { orgId, i18n }) => {
    const journal = await JournalService.getJournal(orgId, data.journalCode);

    return {
      message: i18n.getMessage("SUCCESS_JOURNAL_RETRIEVED"),
      data: JournalService.toDto(journal),
    };
  },
  {
    action: "GET /journals/{journalCode}",
    permission: "ACCOUNTING_READ",
    productCode: "ACCOUNTING",
  },
);
