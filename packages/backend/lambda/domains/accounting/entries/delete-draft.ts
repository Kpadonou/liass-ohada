import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { LedgerService } from "@/lambda/shared/services/ledger-service";
import { DeleteEntryDraftRequestSchema } from "@liass-ohada/shared/accounting";

export const handler = createHandler(
  DeleteEntryDraftRequestSchema,
  async (data, { orgId, i18n }) => {
    const result = await LedgerService.deleteDraftEntry(
      orgId,
      data.year,
      data.entryId,
    );

    return {
      message: i18n.getMessage("SUCCESS_ENTRY_DRAFT_DELETED"),
      entryId: result.entryId,
    };
  },
  {
    action: "DELETE /entries/{entryId}/draft",
    permission: "ACCOUNTING_WRITE",
    productCode: "ACCOUNTING",
  },
);
