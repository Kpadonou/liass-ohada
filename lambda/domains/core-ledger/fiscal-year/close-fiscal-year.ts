import {
  AppError,
  createHandler,
} from "@/lambda/shared/middleware/handler-wrapper";
import { BalanceService } from "@/lambda/shared/services/balance-service";
import { ClosingService } from "@/lambda/shared/services/closing-service";
import { LedgerService } from "@/lambda/shared/services/ledger-service";
import { z } from "zod";

const CloseYearSchema = z.object({
  year: z.string().regex(/^\d{4}$/),
});

export const handler = createHandler(CloseYearSchema, async (data, context) => {
  const { orgId, userId, i18n } = context;
  const { year } = data;

  // 1. Check if the fiscal year is open
  const fiscalYear = await LedgerService.getFiscalYear(orgId, year);

  if (fiscalYear.status !== "OPEN") {
    throw new AppError(400, "ERROR_FISCAL_YEAR_LOCKED");
  }

  // 2. Fetch all account balances
  const allBalances = await BalanceService.getTrialBalance(orgId, year);

  // 3. Filter Management Accounts (Classes 6 & 7)
  const managementBalances = allBalances.filter(
    (b) => b.accountId.startsWith("6") || b.accountId.startsWith("7"),
  );

  if (managementBalances.length === 0) {
    throw new AppError(400, "ERROR_NO_MOVEMENTS_FOUND");
  }

  // 4. Delegate the atomic transaction
  const result = await ClosingService.executeYearEnd(orgId, {
    year,
    userId,
    balances: managementBalances,
  });

  return {
    message: i18n.getMessage("SUCCESS_YEAR_END_CLOSED"),
    data: result,
  };
});
