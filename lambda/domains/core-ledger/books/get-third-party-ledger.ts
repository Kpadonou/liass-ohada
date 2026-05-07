import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { ThirdPartyService } from "@/lambda/shared/services/third-party-service";
import { z } from "zod";

/**
 * @description Validation schema for the Subsidiary Ledger (Grand Livre Auxiliaire).
 */
const SubsidiaryLedgerSchema = z.object({
  accountId: z.string().min(2),
  thirdPartyId: z.string().min(1),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

/**
 * @description Slim handler to retrieve the chronological history of a third-party account.
 * Uses GSI2 for optimized date-range queries.
 */
export const handler = createHandler(
  SubsidiaryLedgerSchema,
  async (data, { orgId, i18n }) => {
    const { accountId, thirdPartyId, startDate, endDate } = data;

    const report = await ThirdPartyService.getLedger(orgId, {
      accountId,
      thirdPartyId,
      startDate,
      endDate,
    });

    return {
      message: i18n.getMessage("SUCCESS_THIRD_PARTY_LEDGER_RETRIEVED"),
      data: report,
    };
  },
);
