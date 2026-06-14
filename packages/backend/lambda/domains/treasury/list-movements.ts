import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { TreasuryService } from "@/lambda/shared/services/treasury-service";
import { z } from "zod";

const currentYear = () => String(new Date().getFullYear());

const ListMovementsSchema = z.object({
  treasuryAccountId: z.string().min(1),
  year: z.coerce.string().regex(/^\d{4}$/).default(currentYear),
});

export const handler = createHandler(
  ListMovementsSchema,
  async (data, { orgId, i18n }) => {
    const movements = await TreasuryService.listMovements(
      orgId,
      data.treasuryAccountId,
      data.year,
    );

    return {
      message: i18n.getMessage("SUCCESS_TREASURY_MOVEMENTS_RETRIEVED"),
      data: {
        movements,
      },
    };
  },
);
