import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { LedgerService } from "@/lambda/shared/services/ledger-service";
import { CreateEntryDraftRequestSchema } from "@liass-ohada/shared/accounting";

export const handler = createHandler(
  CreateEntryDraftRequestSchema,
  async (data, { orgId, userId, i18n }) => {
    const draft = await LedgerService.createDraftEntry({ orgId, userId, data });

    return {
      message: i18n.getMessage("SUCCESS_ENTRY_DRAFT_CREATED"),
      data: draft,
    };
  },
);
