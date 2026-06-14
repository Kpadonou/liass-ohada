import { z } from "zod";

// --- Enums & Constants ---

export const AccountingFramework = z.enum(["SYSCOHADA_REVISED", "SYCEBNL"]);
export const EntryStatus = z.enum(["DRAFT", "POSTED", "CANCELLED"]);
export const EntryType = z.enum([
  "STANDARD",
  "OPENING",
  "CLOSING",
  "ADJUSTMENT",
]);

/** * Amounts are stored as integers (cents/smallest unit)
 */
const MoneySchema = z.number().int().nonnegative().default(0);

// --- Input Schemas (API Validation) ---

/**
 * Validation for an individual line within a creation request.
 * Note: projectId is optional, but essential for SYCEBNL tracking.
 */
export const EntryLineInputSchema = z
  .object({
    accountId: z
      .string()
      .regex(/^\d{8}$/, "Account ID must be exactly 8 digits"),
    projectId: z.string().optional(),
    budgetLineId: z.string().optional(),
    thirdPartyId: z.string().optional(),
    donorId: z.string().optional(),
    debit: MoneySchema,
    credit: MoneySchema,
    description: z.string().optional(),
    label: z.string().optional(),
  })
  .refine(
    (data) =>
      (data.debit > 0 && data.credit === 0) ||
      (data.credit > 0 && data.debit === 0),
    {
      message: "A line must have either a debit or a credit, but not both.",
      path: ["debit"],
    },
  );

/**
 * Validation for the global entry creation request.
 */
export const CreateEntryRequestSchema = z.object({
  orgId: z.string().optional(),
  year: z.number().int(),
  accountingFramework: AccountingFramework.default("SYSCOHADA_REVISED"),
  entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  journalCode: z.string().min(1).max(10).default("MISC"),
  voucherNumber: z.string().optional(),
  entryId: z.string().optional(),
  entryType: EntryType.default("STANDARD"),
  label: z.string().min(3).max(255),
  currency: z.string().optional(),
  lines: z.array(EntryLineInputSchema).min(2),
});

export type CreateEntryRequest = z.infer<typeof CreateEntryRequestSchema>;

/**
 * Request schema for querying paginated ledger entries for an account.
 * Note: accountId and fiscalYear are extracted from path parameters.
 */
export const GetEntriesRequestSchema = z.object({
  accountId: z.string().min(1, "Account ID is required"),
  fiscalYear: z.coerce.string().min(1, "Fiscal year is required"),
  limit: z.coerce.number().int().min(1).max(1000).default(50).optional(),
  cursor: z.string().optional(),
});

export type GetEntriesRequest = z.infer<typeof GetEntriesRequestSchema>;

export const ListEntriesRequestSchema = z
  .object({
    year: z.string().regex(/^\d{4}$/),
    journalCode: z.string().min(1).max(10).optional(),
    month: z
      .string()
      .regex(/^\d{2}$/)
      .optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50).optional(),
    cursor: z.string().optional(),
  })
  .refine((data) => !data.month || !!data.journalCode, {
    message: "journalCode is required when month is provided",
    path: ["journalCode"],
  });

export type ListEntriesRequest = z.infer<typeof ListEntriesRequestSchema>;

export const EntrySummaryDtoSchema = z.object({
  entryId: z.string(),
  year: z.number().int().optional(),
  entryDate: z.string(),
  journalCode: z.string(),
  voucherNumber: z.string().optional(),
  label: z.string().optional(),
  totalDebit: MoneySchema,
  totalCredit: MoneySchema,
  status: EntryStatus,
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type EntrySummaryDto = z.infer<typeof EntrySummaryDtoSchema>;

export const ListEntriesResponseSchema = z.object({
  message: z.unknown().optional(),
  data: z.object({
    entries: z.array(EntrySummaryDtoSchema),
    nextCursor: z.string().optional(),
    hasMore: z.boolean(),
  }),
});

export const PostEntryResponseSchema = z.object({
  message: z.unknown().optional(),
  entryId: z.string(),
});

export const AccountEntryDtoSchema = z.object({
  entryId: z.string(),
  lineId: z.string(),
  accountId: z.string().regex(/^\d{8}$/),
  debit: z.number().int().nonnegative(),
  credit: z.number().int().nonnegative(),
  description: z.string().optional(),
  label: z.string().optional(),
  entryDate: z.string(),
  voucherNumber: z.string().optional(),
  journalCode: z.string().optional(),
  thirdPartyId: z.string().optional(),
  projectId: z.string().optional(),
  letteringCode: z.string().optional(),
  letteringStatus: z.enum(["PARTIAL", "COMPLETE"]).optional(),
  createdAt: z.string(),
});

export type AccountEntryDto = z.infer<typeof AccountEntryDtoSchema>;

export const AccountEntriesResponseSchema = z.object({
  message: z.unknown().optional(),
  data: z.object({
    entries: z.array(AccountEntryDtoSchema),
    nextCursor: z.string().optional(),
    hasMore: z.boolean(),
  }),
});

export const LedgerMovementDtoSchema = z.object({
  date: z.string(),
  label: z.string(),
  reference: z.string(),
  journal: z.string(),
  debit: z.number().int().nonnegative(),
  credit: z.number().int().nonnegative(),
  runningBalance: z.number().int(),
});

export const GeneralLedgerDtoSchema = z.object({
  accountId: z.string(),
  openingBalance: LedgerMovementDtoSchema,
  movements: z.array(LedgerMovementDtoSchema),
  finalBalance: z.number().int(),
});

export type GeneralLedgerDto = z.infer<typeof GeneralLedgerDtoSchema>;

export const GeneralLedgerResponseSchema = z.object({
  message: z.unknown().optional(),
  data: GeneralLedgerDtoSchema,
});

export const TrialBalanceRowDtoSchema = z.object({
  accountId: z.string(),
  openingDebit: z.number().int().nonnegative(),
  openingCredit: z.number().int().nonnegative(),
  movementDebit: z.number().int().nonnegative(),
  movementCredit: z.number().int().nonnegative(),
  finalDebit: z.number().int().nonnegative(),
  finalCredit: z.number().int().nonnegative(),
});

export const TrialBalanceDtoSchema = z.object({
  rows: z.array(TrialBalanceRowDtoSchema),
  totals: TrialBalanceRowDtoSchema.omit({ accountId: true }),
});

export type TrialBalanceDto = z.infer<typeof TrialBalanceDtoSchema>;

export const TrialBalanceResponseSchema = z.object({
  message: z.unknown().optional(),
  data: TrialBalanceDtoSchema,
});

export const IncomeStatementDtoSchema = z.object({
  fiscalYear: z.string(),
  totalRevenue: z.number().int(),
  totalExpenses: z.number().int(),
  netResult: z.number().int(),
  performanceStatus: z.enum(["PROFIT", "LOSS"]),
  statementBasis: z.literal("BACKEND_V1_CLASS_6_7_AGGREGATE"),
});

export type IncomeStatementDto = z.infer<typeof IncomeStatementDtoSchema>;

export const IncomeStatementResponseSchema = z.object({
  message: z.unknown().optional(),
  data: IncomeStatementDtoSchema,
});

export const ThirdPartyLedgerLineDtoSchema = z.object({
  date: z.string(),
  label: z.string().optional(),
  reference: z.string().optional(),
  debit: z.number().int().nonnegative(),
  credit: z.number().int().nonnegative(),
  letteringCode: z.string().nullable(),
  entryId: z.string(),
  lineId: z.string().optional(),
});

export const ThirdPartyLedgerDtoSchema = z.object({
  accountId: z.string(),
  thirdPartyId: z.string(),
  period: z.object({
    startDate: z.string().optional(),
    endDate: z.string().optional(),
  }),
  summary: z.object({
    totalDebit: z.number().int().nonnegative(),
    totalCredit: z.number().int().nonnegative(),
    balance: z.number().int(),
  }),
  count: z.number().int().nonnegative(),
  lines: z.array(ThirdPartyLedgerLineDtoSchema),
});

export type ThirdPartyLedgerDto = z.infer<typeof ThirdPartyLedgerDtoSchema>;

export const ThirdPartyLedgerResponseSchema = z.object({
  message: z.unknown().optional(),
  data: ThirdPartyLedgerDtoSchema,
});

export const LetteringLineRefSchema = z.object({
  year: z.coerce.number().int().gte(1900),
  entryId: z.string().min(1),
  lineId: z.string().min(1),
});

export const PostLetteringRequestSchema = z.object({
  accountId: z.string().regex(/^\d{2,8}$/),
  thirdPartyId: z.string().min(1),
  letteringCode: z.string().min(1),
  lines: z.array(LetteringLineRefSchema).min(2),
});

export const CancelLetteringRequestSchema = z.object({
  accountId: z.string().regex(/^\d{2,8}$/),
  thirdPartyId: z.string().min(1),
  lines: z.array(LetteringLineRefSchema).min(1),
});

export const LetteringResultDtoSchema = z.object({
  letteringCode: z.string().optional(),
  letteringStatus: z.enum(["PARTIAL", "COMPLETE"]).optional(),
  remainingBalance: z.number().int().nonnegative().optional(),
  linesProcessed: z.number().int().nonnegative().optional(),
});

export const LetteringResponseSchema = z.object({
  message: z.unknown().optional(),
}).and(LetteringResultDtoSchema);

export type PostLetteringRequest = z.infer<typeof PostLetteringRequestSchema>;
export type CancelLetteringRequest = z.infer<typeof CancelLetteringRequestSchema>;
export type LetteringResultDto = z.infer<typeof LetteringResultDtoSchema>;

// --- Persistence Schemas (DynamoDB Items) ---
// Backend-only persistence schemas. Public DTOs above must not expose PK/SK/GSI*.

/**
 * Entry Header Item (PK: ORG#{orgId}#FY#{year}, SK: E#{entryId})
 */
export const EntrySchema = z.object({
  orgId: z.string(),
  year: z.number().int(),
  entryId: z.string(),
  entryType: EntryType,
  voucherNumber: z.string().optional(),
  journalCode: z.string(),
  entryDate: z.string(),
  label: z.string(),
  totalDebit: MoneySchema,
  totalCredit: MoneySchema,
  status: EntryStatus,
  entityType: z.literal("ENTRY"),
  PK: z.string(),
  SK: z.string(),
  GSI5PK: z.string().optional(),
  GSI5SK: z.string().optional(),
  createdBy: z.string().optional(),
  createdAt: z.string(),
  updatedBy: z.string().optional(),
  updatedAt: z.string(),
});

export type Entry = z.infer<typeof EntrySchema>;

/**
 * Entry Line Item (PK: ORG#{orgId}#FY#{year}, SK: E#{entryId}#LIN#{lineId})
 */
export const EntryLineSchema = z.object({
  // Identity & Links
  orgId: z.string(),
  year: z.number().int(),
  entryId: z.string(),
  lineId: z.string(),

  // Accounting Core Data
  accountId: z.string().regex(/^\d{8}$/),
  projectId: z.string().optional(),
  budgetLineId: z.string().optional(),
  thirdPartyId: z.string().optional(),
  donorId: z.string().optional(),
  debit: MoneySchema,
  credit: MoneySchema,
  label: z.string().optional(),
  description: z.string().optional(),
  entryDate: z.string(),
  journalCode: z.string(),
  voucherNumber: z.string().optional(),

  // Metadata
  letteringCode: z.string().optional(),
  letteringStatus: z.enum(["PARTIAL", "COMPLETE"]).optional(),
  entityType: z.literal("ENTRY_LINE"),

  // Database Keys (DynamoDB + KeyFactory)
  PK: z.string(),
  SK: z.string(),

  // Index Keys (GSI 1, 2, 3, 4)
  GSI1PK: z.string(),
  GSI1SK: z.string(),
  GSI2PK: z.string().optional(),
  GSI2SK: z.string().optional(),
  GSI3PK: z.string().optional(), // Pour GSI3
  GSI3SK: z.string().optional(), // Pour GSI3
  GSI4PK: z.string().optional(), // Pour GSI_PROJECT (SYCEBNL)
  GSI4SK: z.string().optional(), // Pour GSI_PROJECT (SYCEBNL)

  createdBy: z.string().optional(),
  createdAt: z.string(),
  updatedBy: z.string().optional(),
  updatedAt: z.string(),
});

export type EntryLine = z.infer<typeof EntryLineSchema>;
