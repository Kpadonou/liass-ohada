import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { LedgerService } from "@/lambda/shared/services/ledger-service";
import { z } from "zod";

const GeneralLedgerRequestSchema = z.object({
  fiscalYear: z
    .string()
    .regex(/^\d{4}$/, "Fiscal year must be a 4-digit string"),
  accountId: z
    .string()
    .regex(/^\d{2,8}$/, "Account ID must be numeric with 2-8 digits"),
});

export const handler = createHandler(
  GeneralLedgerRequestSchema,
  async (data, { orgId, i18n }) => {
    const ledger = await LedgerService.getGeneralLedger(
      orgId,
      data.fiscalYear,
      data.accountId,
    );

    return {
      message: i18n.getMessage("SUCCESS_LEDGER_RETRIEVED"),
      data: ledger,
    };
  },
);
