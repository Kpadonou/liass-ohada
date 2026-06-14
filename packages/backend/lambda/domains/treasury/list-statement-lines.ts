import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { TreasuryService } from "@/lambda/shared/services/treasury-service";
import { z } from "zod";

const currentYear = () => String(new Date().getFullYear());

const ListStatementLinesSchema = z.object({
  treasuryAccountId: z.string().min(1),
  year: z.coerce.string().regex(/^\d{4}$/).default(currentYear),
});

export const handler = createHandler(
  ListStatementLinesSchema,
  async (data, { orgId, i18n }) => {
    const statementLines = await TreasuryService.listStatementLines(
      orgId,
      data.treasuryAccountId,
      data.year,
    );

    return {
      message: i18n.getMessage("SUCCESS_BANK_STATEMENT_LINES_RETRIEVED"),
      data: {
        statementLines,
      },
    };
  },
);
