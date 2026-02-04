import { z } from "zod";

export const AccountNature = z.enum(["BALANCE", "INCOME"]);
export const AccountUsage = z.enum(["DEBIT_ONLY", "CREDIT_ONLY", "BOTH"]);

export const AccountSchema = z
  .object({
    orgId: z.string(),
    accountId: z
      .string()
      .regex(/^\d{8}$/, "Account ID must be exactly 8 digits"),
    accountName: z.string(),
    accountNature: AccountNature,
    accountUsage: AccountUsage,
    isThirdPartyAccount: z.boolean(),
    classCode: z.number().int().min(1).max(8),
    financialStatementCode: z.string(),
    allowReconciliation: z.boolean(),
    entityType: z.literal("ACCOUNT"),
    PK: z.string(),
    SK: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .refine(
    (data) => {
      if (!data.accountId || typeof data.classCode === "undefined")
        return false;
      return data.accountId.charAt(0) === String(data.classCode);
    },
    {
      message: "ERROR_ACCOUNT_NUMBER_CLASS_MISMATCH",
    }
  );

export type Account = z.infer<typeof AccountSchema>;

export const padAccountId = (accountId: string): string => {
  return accountId.padEnd(8, "0");
};
