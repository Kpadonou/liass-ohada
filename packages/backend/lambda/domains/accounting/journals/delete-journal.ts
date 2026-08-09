import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { JournalService } from "@/lambda/shared/services/journal-service";
import { z } from "zod";

const DeleteJournalSchema = z.object({
  journalCode: z.string().min(1),
});

export const handler = createHandler(
  DeleteJournalSchema,
  async (data, { orgId, i18n }) => {
    await JournalService.deleteJournal(orgId, data.journalCode);

    return {
      message: i18n.getMessage("JOURNAL_DELETED"),
      data: {},
    };
  },
  {
    action: "DELETE /journals/{journalCode}",
    permission: "ACCOUNTING_WRITE",
    productCode: "ACCOUNTING",
  },
);
