import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { TreasuryService } from "@/lambda/shared/services/treasury-service";
import { z } from "zod";

export const handler = createHandler(
  z.object({}),
  async (_data, { orgId, i18n }) => {
    const accounts = await TreasuryService.listAccounts(orgId);

    return {
      message: i18n.getMessage("SUCCESS_TREASURY_ACCOUNTS_RETRIEVED"),
      data: {
        accounts,
      },
    };
  },
);
