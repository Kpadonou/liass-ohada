import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { LedgerService } from "@/lambda/shared/services/ledger-service";
import {
  GeneralLedgerQuerySchema,
  GeneralLedgerResponseSchema,
} from "@liass-ohada/shared/accounting";

export const handler = createHandler(
  GeneralLedgerQuerySchema,
  async (data, { orgId, i18n }) => {
    const ledger = await LedgerService.getGeneralLedger(orgId, data);

    return GeneralLedgerResponseSchema.parse({
      message: i18n.getMessage("SUCCESS_LEDGER_RETRIEVED"),
      data: ledger,
    });
  },
  {
    action: "GET /books/general-ledger",
    permission: "ACCOUNTING_READ",
    productCode: "ACCOUNTING",
  },
);
