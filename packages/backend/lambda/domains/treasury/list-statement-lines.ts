import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { TreasuryService } from "@/lambda/shared/services/treasury-service";
import { ListBankStatementLinesRequestSchema } from "@liass-ohada/shared/treasury";

export const handler = createHandler(
  ListBankStatementLinesRequestSchema,
  async (data, { orgId, i18n }) => {
    const result = await TreasuryService.listStatementLines(
      orgId,
      data.treasuryAccountId,
      data.year,
      data,
    );

    return {
      message: i18n.getMessage("SUCCESS_BANK_STATEMENT_LINES_RETRIEVED"),
      data: {
        statementLines: result.statementLines,
        nextCursor: result.nextCursor,
        hasMore: result.hasMore,
        count: result.count,
      },
    };
  },
);
