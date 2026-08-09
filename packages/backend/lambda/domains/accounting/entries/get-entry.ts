import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { LedgerService } from "@/lambda/shared/services/ledger-service";
import { GetEntryDetailRequestSchema } from "@liass-ohada/shared/accounting";

export const handler = createHandler(
  GetEntryDetailRequestSchema,
  async (data, { orgId, i18n }) => {
    const detail = await LedgerService.getEntryDetail(
      orgId,
      data.year,
      data.entryId,
    );

    return {
      message: i18n.getMessage("SUCCESS_ENTRY_RETRIEVED"),
      data: detail,
    };
  },
  {
    action: "GET /entries/{entryId}",
    permission: "ACCOUNTING_READ",
    productCode: "ACCOUNTING",
  },
);
