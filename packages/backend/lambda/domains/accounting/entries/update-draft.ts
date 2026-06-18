import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { LedgerService } from "@/lambda/shared/services/ledger-service";
import { UpdateEntryDraftRequestSchema } from "@liass-ohada/shared/accounting";

export const handler = createHandler(
  UpdateEntryDraftRequestSchema,
  async (data, { orgId, userId, i18n }) => {
    const draft = await LedgerService.updateDraftEntry({ orgId, userId, data });

    return {
      message: i18n.getMessage("SUCCESS_ENTRY_DRAFT_UPDATED"),
      data: draft,
    };
  },
);
