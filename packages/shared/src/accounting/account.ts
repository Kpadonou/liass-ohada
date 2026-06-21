import { z } from "zod";

export const AccountNature = z.enum(["BALANCE", "INCOME"]);
export const AccountUsage = z.enum(["DEBIT_ONLY", "CREDIT_ONLY", "BOTH"]);
export const AccountClassCode = z.number().int().min(1).max(8);
export const AuxiliaryType = z.enum([
  "CUSTOMER",
  "SUPPLIER",
  "THIRD_PARTY",
  "NONE",
]);

export type AuxiliaryTypeValue = z.infer<typeof AuxiliaryType>;

const AccountAuxiliaryFields = {
  requiresThirdParty: z.boolean().optional(),
  auxiliaryType: AuxiliaryType.optional(),
};

export function isValidAccountAuxiliaryConfiguration(data: {
  isThirdPartyAccount: boolean;
  requiresThirdParty?: boolean;
  auxiliaryType?: AuxiliaryTypeValue;
}): boolean {
  if (
    data.requiresThirdParty === undefined &&
    data.auxiliaryType === undefined
  ) {
    return true;
  }

  if (
    data.requiresThirdParty === undefined ||
    data.auxiliaryType === undefined
  ) {
    return false;
  }

  const isAuxiliary = data.auxiliaryType !== "NONE";
  return (
    data.requiresThirdParty === isAuxiliary &&
    data.isThirdPartyAccount === isAuxiliary
  );
}

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
    ...AccountAuxiliaryFields,
    classCode: AccountClassCode,
    financialStatementCode: z.string(),
    allowReconciliation: z.boolean(),
    isActive: z.boolean().default(true),
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
    },
  )
  .refine(isValidAccountAuxiliaryConfiguration, {
    message: "ACCOUNT_AUXILIARY_CONFIGURATION_INVALID",
  });

export type Account = z.infer<typeof AccountSchema>;

export const AccountDtoSchema = z.object({
  orgId: z.string().optional(),
  accountId: z.string().regex(/^\d{8}$/),
  accountName: z.string(),
  accountNature: AccountNature,
  accountUsage: AccountUsage,
  isThirdPartyAccount: z.boolean(),
  requiresThirdParty: z.boolean().optional(),
  auxiliaryType: AuxiliaryType.optional(),
  classCode: AccountClassCode,
  financialStatementCode: z.string(),
  allowReconciliation: z.boolean(),
  isActive: z.boolean().default(true),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type AccountDto = z.infer<typeof AccountDtoSchema>;

export const CreateAccountRequestSchema = z.object({
  accountId: z.string().min(1),
  accountName: z.string(),
  accountNature: AccountNature,
  accountUsage: AccountUsage,
  isThirdPartyAccount: z.boolean(),
  ...AccountAuxiliaryFields,
  classCode: AccountClassCode,
  financialStatementCode: z.string(),
  allowReconciliation: z.boolean(),
}).refine(isValidAccountAuxiliaryConfiguration, {
  message: "ACCOUNT_AUXILIARY_CONFIGURATION_INVALID",
});

export type CreateAccountRequest = z.infer<typeof CreateAccountRequestSchema>;

export const UpdateAccountRequestSchema = z
  .object({
    accountName: z.string(),
    accountNature: AccountNature,
    accountUsage: AccountUsage,
    isThirdPartyAccount: z.boolean(),
    ...AccountAuxiliaryFields,
    classCode: AccountClassCode,
    financialStatementCode: z.string(),
    allowReconciliation: z.boolean(),
  })
  .partial()
  .refine((payload) => Object.keys(payload).length > 0, {
    message: "At least one account field is required",
  });

export type UpdateAccountRequest = z.infer<typeof UpdateAccountRequestSchema>;

export const AccountResponseSchema = z.object({
  message: z.unknown().optional(),
  account: AccountDtoSchema,
});

export const ListAccountsRequestSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100).optional(),
  cursor: z.string().optional(),
  search: z.string().trim().regex(/^\d{1,8}$/).optional(),
  class: z.coerce.number().int().min(1).max(8).optional(),
  active: z
    .preprocess(
      (value) => {
        if (value === "true") return true;
        if (value === "false") return false;
        return value;
      },
      z.boolean(),
    )
    .optional(),
  activeOnly: z
    .preprocess(
      (value) => {
        if (value === "true") return true;
        if (value === "false") return false;
        return value;
      },
      z.boolean(),
    )
    .optional(),
});

export type ListAccountsRequest = z.infer<typeof ListAccountsRequestSchema>;

export const ListAccountsResponseSchema = z.object({
  message: z.unknown().optional(),
  data: z
    .object({
      items: z.array(AccountDtoSchema).optional(),
      accounts: z.array(AccountDtoSchema).optional(),
      nextCursor: z.string().optional(),
      hasMore: z.boolean().optional(),
    })
    .transform((data) => ({
      ...data,
      hasMore: data.hasMore ?? !!data.nextCursor,
      items: data.items ?? data.accounts ?? [],
    })),
});

export const GetAccountRequestSchema = z.object({
  accountId: z.string().min(1, "Account ID is required"),
});

export const padAccountId = (accountId: string): string => {
  return accountId.padEnd(8, "0");
};
