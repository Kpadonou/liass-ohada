import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { TreasuryService } from "@/lambda/domains/treasury/services/treasury-service";
import { ImportBankStatementRequestSchema } from "@liass-ohada/shared/treasury";
import { z } from "zod";

const ImportStatementLinesSchema = ImportBankStatementRequestSchema.extend({
  treasuryAccountId: z.string().min(1),
});

export const handler = createHandler(
  ImportStatementLinesSchema,
  async (data, { orgId, i18n }) => {
    const result = await TreasuryService.importStatementLines({
      orgId,
      treasuryAccountId: data.treasuryAccountId,
      year: data.year,
      lines: data.lines,
    });

    return {
      message: i18n.getMessage("SUCCESS_BANK_STATEMENT_IMPORTED"),
      data: result,
    };
  },
  {
    action:
      "POST /treasury/accounts/{treasuryAccountId}/statement-lines/import",
    permission: "TREASURY_WRITE",
    productCode: "ACCOUNTING",
  },
);
