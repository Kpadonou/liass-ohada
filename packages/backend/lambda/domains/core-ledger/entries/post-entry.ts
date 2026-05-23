import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { LedgerService } from "@/lambda/shared/services/ledger-service";
import { CreateEntryRequestSchema } from "@liass-ohada/shared/core-ledger";

export const handler = createHandler(
  CreateEntryRequestSchema,
  async (data, { orgId, userId, i18n }) => {
    const result = await LedgerService.postEntry({ orgId, userId, data });

    return {
      message: i18n.getMessage("SUCCESS_ENTRY_POSTED"),
      entryId: result.entryId,
    };
  },
);
