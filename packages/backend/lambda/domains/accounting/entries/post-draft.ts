import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { LedgerService } from "@/lambda/shared/services/ledger-service";
import { PostEntryDraftRequestSchema } from "@liass-ohada/shared/accounting";

export const handler = createHandler(
  PostEntryDraftRequestSchema,
  async (data, { orgId, userId, i18n }) => {
    const result = await LedgerService.postDraftEntry(
      orgId,
      userId,
      data.year,
      data.entryId,
    );

    return {
      message: i18n.getMessage("SUCCESS_ENTRY_POSTED"),
      entryId: result.entryId,
    };
  },
);
