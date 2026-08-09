import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { JournalService } from "@/lambda/shared/services/journal-service";
import { z } from "zod";

export const handler = createHandler(
  z.object({}),
  async (_data, { orgId, i18n }) => {
    const journals = await JournalService.listJournals(orgId);

    return {
      message: i18n.getMessage("JOURNALS_RETRIEVED"),
      data: journals,
    };
  },
  {
    action: "GET /journals",
    permission: "ACCOUNTING_READ",
    productCode: "ACCOUNTING",
  },
);
