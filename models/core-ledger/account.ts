import { z } from "zod";

export const AccountNature = z.enum(["BALANCE", "INCOME"]);
export const AccountUsage = z.enum(["DEBIT_ONLY", "CREDIT_ONLY", "BOTH"]);

export const AccountSchema = z.object({
  orgId: z.string(),
  year: z.number(),
  accountNumber: z.string(),
  accountId: z.string(), // padded
  accountName: z.string(),
  accountNature: AccountNature,
  accountUsage: AccountUsage,
  isThirdPartyAccount: z.boolean(),
  classCode: z.number().min(1).max(8),
  financialStatementCode: z.string(),
  allowReconciliation: z.boolean(),
  entityType: z.literal("ACCOUNT"),
  pk: z.string(),
  sk: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Account = z.infer<typeof AccountSchema>;

export const padAccountNumber = (accountNumber: string): string => {
  return accountNumber.padStart(8, "0");
};
