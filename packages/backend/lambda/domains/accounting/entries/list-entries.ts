import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { LedgerService } from "@/lambda/shared/services/ledger-service";
import { ListEntriesRequestSchema } from "@liass-ohada/shared/accounting";

export const handler = createHandler(
  ListEntriesRequestSchema,
  async (data, { orgId, i18n }) => {
    const result = await LedgerService.listEntries(orgId, {
      year: data.year,
      journalCode: data.journalCode,
      status: data.status,
      month: data.month,
      limit: data.limit,
      cursor: data.cursor,
    });

    return {
      message: i18n.getMessage("SUCCESS_ENTRIES_RETRIEVED"),
      data: result,
    };
  },
  {
    action: "GET /entries",
    permission: "ACCOUNTING_READ",
    productCode: "ACCOUNTING",
  },
);
