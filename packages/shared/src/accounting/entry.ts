import { z } from "zod";
import { AccountDtoSchema } from "./account";
import {
  ThirdPartyDtoSchema,
  ThirdPartyStatus,
  ThirdPartyType,
} from "./third-party";

// --- Enums & Constants ---

export const AccountingFramework = z.enum(["SYSCOHADA_REVISED", "SYCEBNL"]);
export const EntryStatus = z.enum(["DRAFT", "POSTED", "CANCELLED"]);
export const EntryType = z.enum([
  "STANDARD",
  "OPENING",
  "CLOSING",
  "ADJUSTMENT",
]);
export const LineLetteringStatus = z.enum([
  "UNLETTERED",
  "PARTIAL",
  "LETTERED",
  "COMPLETE",
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
    thirdPartyType: ThirdPartyType.optional(),
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

export const EntryDraftLineInputSchema = z.object({
  lineId: z.string().optional(),
  accountId: z
    .string()
    .regex(/^\d{8}$/, "Account ID must be exactly 8 digits"),
  projectId: z.string().optional(),
  budgetLineId: z.string().optional(),
  thirdPartyId: z.string().optional(),
  thirdPartyType: ThirdPartyType.optional(),
  donorId: z.string().optional(),
  debit: MoneySchema,
  credit: MoneySchema,
  description: z.string().optional(),
  label: z.string().optional(),
});

/**
 * Validation for the global entry creation request.
 */
export const CreateEntryRequestSchema = z.object({
  year: z.number().int(),
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

export const CreateEntryDraftRequestSchema = z.object({
  year: z.number().int(),
  entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  journalCode: z.string().min(1).max(10).default("MISC"),
  voucherNumber: z.string().optional(),
  entryType: EntryType.default("STANDARD"),
  label: z.string().max(255).optional(),
  currency: z.string().optional(),
  lines: z.array(EntryDraftLineInputSchema).max(49).default([]),
});

export const UpdateEntryDraftRequestSchema = CreateEntryDraftRequestSchema.extend({
  entryId: z.string().min(1),
});

export const DeleteEntryDraftRequestSchema = z.object({
  entryId: z.string().min(1),
  year: z.coerce.number().int(),
});

export const PostEntryDraftRequestSchema = DeleteEntryDraftRequestSchema;

export const GetEntryDetailRequestSchema = z.object({
  entryId: z.string().min(1),
  year: z.coerce.number().int(),
});

export type CreateEntryDraftRequest = z.infer<typeof CreateEntryDraftRequestSchema>;
export type UpdateEntryDraftRequest = z.infer<typeof UpdateEntryDraftRequestSchema>;
export type DeleteEntryDraftRequest = z.infer<typeof DeleteEntryDraftRequestSchema>;
export type PostEntryDraftRequest = z.infer<typeof PostEntryDraftRequestSchema>;
export type GetEntryDetailRequest = z.infer<typeof GetEntryDetailRequestSchema>;

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
    status: EntryStatus.optional(),
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

export const EntryLineDtoSchema = z.object({
  lineId: z.string(),
  accountId: z.string().regex(/^\d{8}$/),
  accountName: z.string().optional(),
  debit: z.number().int().nonnegative(),
  credit: z.number().int().nonnegative(),
  description: z.string().optional(),
  label: z.string().optional(),
  thirdPartyId: z.string().optional(),
  thirdPartyType: ThirdPartyType.optional(),
  thirdPartyCode: z.string().optional(),
  thirdPartyName: z.string().optional(),
  projectId: z.string().optional(),
  budgetLineId: z.string().optional(),
  donorId: z.string().optional(),
  letteringCode: z.string().optional(),
  letteringStatus: LineLetteringStatus.optional(),
});

export const EntryDetailDtoSchema = z.object({
  entryId: z.string(),
  year: z.number().int(),
  entryDate: z.string(),
  journalCode: z.string(),
  voucherNumber: z.string().optional(),
  entryType: EntryType,
  label: z.string().optional(),
  totalDebit: z.number().int().nonnegative(),
  totalCredit: z.number().int().nonnegative(),
  status: EntryStatus,
  lines: z.array(EntryLineDtoSchema),
  createdBy: z.string().optional(),
  createdAt: z.string().optional(),
  updatedBy: z.string().optional(),
  updatedAt: z.string().optional(),
  postedBy: z.string().optional(),
  postedAt: z.string().optional(),
});

export type EntryLineDto = z.infer<typeof EntryLineDtoSchema>;
export type EntryDetailDto = z.infer<typeof EntryDetailDtoSchema>;

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

export const EntryDetailResponseSchema = z.object({
  message: z.unknown().optional(),
  data: EntryDetailDtoSchema,
});

export const EntryDraftResponseSchema = EntryDetailResponseSchema;

export const DeleteEntryDraftResponseSchema = z.object({
  message: z.unknown().optional(),
  entryId: z.string(),
});

export const AccountEntryDtoSchema = z.object({
  entryId: z.string(),
  year: z.number().int().optional(),
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
  thirdPartyType: ThirdPartyType.optional(),
  thirdPartyCode: z.string().optional(),
  thirdPartyName: z.string().optional(),
  projectId: z.string().optional(),
  letteringCode: z.string().optional(),
  letteringStatus: LineLetteringStatus.optional(),
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

export const GeneralLedgerQuerySchema = z.object({
  fiscalYear: z.string().regex(/^\d{4}$/),
  accountId: z.string().regex(/^\d{2,8}$/),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50).optional(),
  cursor: z.string().optional(),
}).superRefine((query, context) => {
  if (query.startDate && !query.startDate.startsWith(`${query.fiscalYear}-`)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Start date must belong to the fiscal year",
      path: ["startDate"],
    });
  }

  if (query.endDate && !query.endDate.startsWith(`${query.fiscalYear}-`)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "End date must belong to the fiscal year",
      path: ["endDate"],
    });
  }

  if (query.startDate && query.endDate && query.startDate > query.endDate) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Start date must not be after end date",
      path: ["endDate"],
    });
  }
});

export type GeneralLedgerQuery = z.infer<typeof GeneralLedgerQuerySchema>;

export const GeneralLedgerLineDtoSchema = z.object({
  date: z.string(),
  label: z.string(),
  reference: z.string().optional(),
  journalCode: z.string(),
  journal: z.string().optional(),
  entryId: z.string().optional(),
  lineId: z.string().optional(),
  debit: z.number().int().nonnegative(),
  credit: z.number().int().nonnegative(),
  runningBalance: z.number().int(),
});

export type GeneralLedgerLineDto = z.infer<
  typeof GeneralLedgerLineDtoSchema
>;

export const GeneralLedgerOpeningBalanceDtoSchema = z
  .object({
    date: z.string().optional(),
    label: z.string().optional(),
    debit: z.number().int().nonnegative(),
    credit: z.number().int().nonnegative(),
    balance: z.number().int().optional(),
    runningBalance: z.number().int().optional(),
  })
  .refine(
    (openingBalance) =>
      openingBalance.balance !== undefined ||
      openingBalance.runningBalance !== undefined,
    {
      message: "Opening balance amount is required",
    },
  )
  .transform(({ runningBalance, ...openingBalance }) => ({
    ...openingBalance,
    balance: openingBalance.balance ?? runningBalance!,
  }));

export type GeneralLedgerOpeningBalanceDto = z.infer<
  typeof GeneralLedgerOpeningBalanceDtoSchema
>;

// Compatibility alias for the existing frontend while Lot 4 moves to journalCode.
export const LedgerMovementDtoSchema = GeneralLedgerLineDtoSchema;

export const GeneralLedgerDtoSchema = z
  .object({
    accountId: z.string().regex(/^\d{8}$/),
    openingBalance: GeneralLedgerOpeningBalanceDtoSchema,
    movements: z.array(GeneralLedgerLineDtoSchema),
    finalBalance: z.number().int(),
    nextCursor: z.string().optional(),
    hasMore: z.boolean().optional(),
  })
  .transform((ledger) => ({
    ...ledger,
    hasMore: ledger.hasMore ?? !!ledger.nextCursor,
  }));

export type GeneralLedgerDto = z.infer<typeof GeneralLedgerDtoSchema>;

export const GeneralLedgerResponseSchema = z.object({
  message: z.unknown().optional(),
  data: GeneralLedgerDtoSchema,
});

export type GeneralLedgerResponse = z.infer<
  typeof GeneralLedgerResponseSchema
>;

export const TrialBalanceQuerySchema = z
  .object({
    year: z.string().regex(/^\d{4}$/),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    accountPrefix: z.string().trim().regex(/^\d{1,8}$/).optional(),
    accountFrom: z.string().trim().regex(/^\d{1,8}$/).optional(),
    accountTo: z.string().trim().regex(/^\d{1,8}$/).optional(),
    accountClass: z.coerce.number().int().min(1).max(8).optional(),
    hideZeroMovement: z
      .preprocess(
        (value) => {
          if (value === "true") return true;
          if (value === "false") return false;
          return value;
        },
        z.boolean(),
      )
      .default(false),
  })
  .superRefine((query, context) => {
    if (!query.startDate.startsWith(`${query.year}-`)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Start date must belong to the fiscal year",
        path: ["startDate"],
      });
    }

    if (!query.endDate.startsWith(`${query.year}-`)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "End date must belong to the fiscal year",
        path: ["endDate"],
      });
    }

    if (query.startDate > query.endDate) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Start date must not be after end date",
        path: ["endDate"],
      });
    }

    if (
      query.accountFrom &&
      query.accountTo &&
      query.accountFrom.padEnd(8, "0") > query.accountTo.padEnd(8, "9")
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Account range start must not be after its end",
        path: ["accountTo"],
      });
    }
  });

export type TrialBalanceQuery = z.infer<typeof TrialBalanceQuerySchema>;

export const TrialBalanceLineDtoSchema = z.object({
  accountCode: z.string().regex(/^\d{8}$/),
  accountLabel: z.string().trim().min(1),
  openingDebit: z.number().int().nonnegative(),
  openingCredit: z.number().int().nonnegative(),
  movementDebit: z.number().int().nonnegative(),
  movementCredit: z.number().int().nonnegative(),
  closingDebit: z.number().int().nonnegative(),
  closingCredit: z.number().int().nonnegative(),
}).refine((row) => row.openingDebit === 0 || row.openingCredit === 0, {
  message: "Opening balance must be represented on one side only",
}).refine((row) => row.closingDebit === 0 || row.closingCredit === 0, {
  message: "Closing balance must be represented on one side only",
});

export type TrialBalanceLineDto = z.infer<
  typeof TrialBalanceLineDtoSchema
>;

// Compatibility alias for callers using the previous row terminology.
export const TrialBalanceRowDtoSchema = TrialBalanceLineDtoSchema;

export const TrialBalanceDtoSchema = z.object({
  rows: z.array(TrialBalanceLineDtoSchema),
  totals: z.object({
    openingDebit: z.number().int().nonnegative(),
    openingCredit: z.number().int().nonnegative(),
    movementDebit: z.number().int().nonnegative(),
    movementCredit: z.number().int().nonnegative(),
    closingDebit: z.number().int().nonnegative(),
    closingCredit: z.number().int().nonnegative(),
    isMovementBalanced: z.boolean(),
    isClosingBalanced: z.boolean(),
    movementDifference: z.number().int(),
    closingDifference: z.number().int(),
  }),
  period: z.object({
    fiscalYear: z.string().regex(/^\d{4}$/),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),
});

export type TrialBalanceDto = z.infer<typeof TrialBalanceDtoSchema>;

export const TrialBalanceResponseSchema = z.object({
  message: z.unknown().optional(),
  data: TrialBalanceDtoSchema,
});

export type TrialBalanceResponse = z.infer<
  typeof TrialBalanceResponseSchema
>;

export const AccountBalanceQuerySchema = z.object({
  fiscalYear: z.string().regex(/^\d{4}$/),
  accountId: z.string().regex(/^\d{2,8}$/),
});

export type AccountBalanceQuery = z.infer<typeof AccountBalanceQuerySchema>;

export const AccountBalanceDtoSchema = z.object({
  accountId: z.string().regex(/^\d{8}$/),
  openingDebit: z.number().int().nonnegative(),
  openingCredit: z.number().int().nonnegative(),
  movementDebit: z.number().int().nonnegative(),
  movementCredit: z.number().int().nonnegative(),
  finalDebit: z.number().int().nonnegative(),
  finalCredit: z.number().int().nonnegative(),
  updatedAt: z.string().optional(),
});

export type AccountBalanceDto = z.infer<typeof AccountBalanceDtoSchema>;

export const AccountBalanceResponseSchema = z.object({
  message: z.unknown().optional(),
  data: AccountBalanceDtoSchema,
});

export const JournalBookQuerySchema = z.object({
  year: z.string().regex(/^\d{4}$/),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  journalCode: z.string().trim().min(1).max(10).optional(),
  entryNumber: z.string().trim().min(1).max(100).optional(),
  reference: z.string().trim().min(1).max(100).optional(),
  accountPrefix: z.string().trim().regex(/^\d{1,8}$/).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50).optional(),
  cursor: z.string().optional(),
}).superRefine((query, context) => {
  if (!query.startDate.startsWith(`${query.year}-`)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Start date must belong to the fiscal year",
      path: ["startDate"],
    });
  }
  if (!query.endDate.startsWith(`${query.year}-`)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "End date must belong to the fiscal year",
      path: ["endDate"],
    });
  }
  if (query.startDate > query.endDate) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Start date must not be after end date",
      path: ["endDate"],
    });
  }
});

export type JournalBookQuery = z.infer<typeof JournalBookQuerySchema>;

export const JournalSpecificBookQuerySchema = z.object({
  year: z.string().regex(/^\d{4}$/),
  journalCode: z.string().min(1).max(10),
  month: z.string().regex(/^(0[1-9]|1[0-2])$/).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50).optional(),
  cursor: z.string().optional(),
});

export type JournalSpecificBookQuery = z.infer<
  typeof JournalSpecificBookQuerySchema
>;

export const JournalBookEntryLineDtoSchema = z.object({
  lineId: z.string().min(1),
  accountCode: z.string().regex(/^\d{8}$/),
  accountLabel: z.string().min(1),
  lineLabel: z.string().optional(),
  thirdPartyCode: z.string().optional(),
  thirdPartyName: z.string().optional(),
  debit: z.number().int().nonnegative(),
  credit: z.number().int().nonnegative(),
}).refine(
  (line) =>
    (line.debit > 0 && line.credit === 0) ||
    (line.credit > 0 && line.debit === 0),
  { message: "A line must have debit or credit, not both" },
);

export type JournalBookEntryLineDto = z.infer<typeof JournalBookEntryLineDtoSchema>;

export const JournalBookEntryDtoSchema = z.object({
  entryId: z.string().min(1),
  entryNumber: z.string().min(1),
  accountingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  journalCode: z.string().min(1),
  journalLabel: z.string().min(1),
  reference: z.string().optional(),
  entryLabel: z.string().min(1),
  status: z.literal("POSTED"),
  totalDebit: z.number().int().nonnegative(),
  totalCredit: z.number().int().nonnegative(),
  isBalanced: z.boolean(),
  lines: z.array(JournalBookEntryLineDtoSchema).min(1),
});

export type JournalBookEntryDto = z.infer<typeof JournalBookEntryDtoSchema>;

export const JournalBookTotalsDtoSchema = z.object({
  totalDebit: z.number().int().nonnegative(),
  totalCredit: z.number().int().nonnegative(),
  difference: z.number().int(),
  isBalanced: z.boolean(),
  entryCount: z.number().int().nonnegative(),
  lineCount: z.number().int().nonnegative(),
});

export type JournalBookTotalsDto = z.infer<typeof JournalBookTotalsDtoSchema>;

// Legacy journal-specific summary contract retained for the existing
// /journals/{journalCode}/entries endpoint.
export const JournalBookLineDtoSchema = z.object({
  entryId: z.string(),
  date: z.string(),
  journalCode: z.string(),
  reference: z.string().optional(),
  label: z.string().optional(),
  totalDebit: z.number().int().nonnegative(),
  totalCredit: z.number().int().nonnegative(),
  status: z.literal("POSTED"),
});

export type JournalBookLineDto = z.infer<typeof JournalBookLineDtoSchema>;

export const JournalBookResponseSchema = z.object({
  message: z.unknown().optional(),
  data: z.object({
    meta: z.object({
      year: z.string().regex(/^\d{4}$/),
      startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      journalCode: z.string().optional(),
    }),
    entries: z.array(JournalBookEntryDtoSchema),
    totals: JournalBookTotalsDtoSchema,
    integrityWarnings: z.array(z.object({
      entryNumber: z.string(),
      difference: z.number().int(),
    })),
    nextCursor: z.string().optional(),
    hasMore: z.boolean(),
  }),
});

export type JournalBookResponse = z.infer<typeof JournalBookResponseSchema>;

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

const BooleanQuerySchema = z
  .preprocess(
    (value) => {
      if (value === "true") return true;
      if (value === "false") return false;
      return value;
    },
    z.boolean(),
  )
  .default(true);

export const SimplifiedReportQuerySchema = z
  .object({
    fiscalYear: z.string().regex(/^\d{4}$/),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    includeAuxiliary: BooleanQuerySchema,
    includeClosingChecks: BooleanQuerySchema,
  })
  .superRefine((query, context) => {
    if (query.startDate && !query.startDate.startsWith(`${query.fiscalYear}-`)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Start date must belong to the fiscal year",
        path: ["startDate"],
      });
    }

    if (query.endDate && !query.endDate.startsWith(`${query.fiscalYear}-`)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "End date must belong to the fiscal year",
        path: ["endDate"],
      });
    }

    if (query.startDate && query.endDate && query.startDate > query.endDate) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Start date must not be after end date",
        path: ["endDate"],
      });
    }
  });

export type SimplifiedReportQuery = z.infer<typeof SimplifiedReportQuerySchema>;

export const SimplifiedReportPeriodDtoSchema = z.object({
  fiscalYear: z.string().regex(/^\d{4}$/),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  generatedAt: z.string(),
});

export const SimplifiedReportTrialBalanceDtoSchema = z.object({
  totalDebit: z.number().int().nonnegative(),
  totalCredit: z.number().int().nonnegative(),
  isBalanced: z.boolean(),
  accountCount: z.number().int().nonnegative().optional(),
  movementCount: z.number().int().nonnegative().optional(),
});

export const SimplifiedReportIncomeAccountDtoSchema = z.object({
  accountId: z.string().regex(/^\d{8}$/),
  totalDebit: z.number().int().nonnegative(),
  totalCredit: z.number().int().nonnegative(),
  netAmount: z.number().int(),
});

export const SimplifiedReportIncomeDtoSchema = z.object({
  totalRevenue: z.number().int(),
  totalExpense: z.number().int(),
  netResult: z.number().int(),
  revenueAccounts: z.array(SimplifiedReportIncomeAccountDtoSchema).optional(),
  expenseAccounts: z.array(SimplifiedReportIncomeAccountDtoSchema).optional(),
});

export const SimplifiedReportAuxiliaryExposureDtoSchema = z.object({
  accountIds: z.array(z.string().regex(/^\d{8}$/)),
  totalDebit: z.number().int().nonnegative(),
  totalCredit: z.number().int().nonnegative(),
  totalBalanceDebit: z.number().int().nonnegative(),
  totalBalanceCredit: z.number().int().nonnegative(),
  unletteredAmount: z.number().int().nonnegative().optional(),
  thirdPartyCount: z.number().int().nonnegative().optional(),
});

export const SimplifiedReportAuxiliaryDtoSchema = z.object({
  customers: SimplifiedReportAuxiliaryExposureDtoSchema.optional(),
  suppliers: SimplifiedReportAuxiliaryExposureDtoSchema.optional(),
});

export const SimplifiedReportClosingReadinessDtoSchema = z.object({
  canClose: z.boolean(),
  errorsCount: z.number().int().nonnegative(),
  warningsCount: z.number().int().nonnegative(),
  draftEntriesCount: z.number().int().nonnegative().optional(),
  unbalancedEntriesCount: z.number().int().nonnegative().optional(),
  unletteredAuxiliaryLinesCount: z.number().int().nonnegative().optional(),
});

export const SimplifiedReportDtoSchema = z.object({
  period: SimplifiedReportPeriodDtoSchema,
  trialBalance: SimplifiedReportTrialBalanceDtoSchema,
  income: SimplifiedReportIncomeDtoSchema,
  auxiliary: SimplifiedReportAuxiliaryDtoSchema.optional(),
  closingReadiness: SimplifiedReportClosingReadinessDtoSchema.optional(),
});

export type SimplifiedReportDto = z.infer<typeof SimplifiedReportDtoSchema>;

export const SimplifiedReportResponseSchema = z.object({
  message: z.unknown().optional(),
  data: SimplifiedReportDtoSchema,
});

export const ThirdPartyLedgerQuerySchema = z.object({
  fiscalYear: z.string().regex(/^\d{4}$/),
  accountId: z.string().regex(/^\d{2,8}$/),
  thirdPartyId: z.string().min(1),
  thirdPartyType: ThirdPartyType,
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50).optional(),
  cursor: z.string().optional(),
}).superRefine((query, context) => {
  if (query.startDate && !query.startDate.startsWith(`${query.fiscalYear}-`)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Start date must belong to the fiscal year",
      path: ["startDate"],
    });
  }

  if (query.endDate && !query.endDate.startsWith(`${query.fiscalYear}-`)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "End date must belong to the fiscal year",
      path: ["endDate"],
    });
  }

  if (query.startDate && query.endDate && query.startDate > query.endDate) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Start date must not be after end date",
      path: ["endDate"],
    });
  }
});

export type ThirdPartyLedgerQuery = z.infer<typeof ThirdPartyLedgerQuerySchema>;

export const ThirdPartyLedgerLineDtoSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  label: z.string().optional(),
  reference: z.string().optional(),
  journalCode: z.string().min(1),
  journal: z.string().optional(),
  debit: z.number().int().nonnegative(),
  credit: z.number().int().nonnegative(),
  runningBalance: z.number().int(),
  letteringCode: z.string().nullable().optional(),
  letteringStatus: LineLetteringStatus.optional(),
  letteredAmount: z.number().int().nonnegative().optional(),
  remainingAmount: z.number().int().nonnegative().optional(),
  entryId: z.string(),
  lineId: z.string().optional(),
});

export const ThirdPartyLedgerDtoSchema = z
  .object({
    accountId: z.string().regex(/^\d{8}$/),
    thirdPartyId: z.string().min(1),
    thirdPartyType: ThirdPartyType,
    account: AccountDtoSchema,
    thirdParty: ThirdPartyDtoSchema,
    period: z.object({
      fiscalYear: z.string().regex(/^\d{4}$/),
      startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }),
    openingBalance: GeneralLedgerOpeningBalanceDtoSchema,
    movements: z.array(ThirdPartyLedgerLineDtoSchema).optional(),
    lines: z.array(ThirdPartyLedgerLineDtoSchema).optional(),
    summary: z.object({
      totalDebit: z.number().int().nonnegative(),
      totalCredit: z.number().int().nonnegative(),
      balance: z.number().int(),
    }),
    count: z.number().int().nonnegative(),
    finalBalance: z.number().int(),
    nextCursor: z.string().optional(),
    hasMore: z.boolean().optional(),
  })
  .transform((ledger) => {
    const movements = ledger.movements ?? ledger.lines ?? [];
    return {
      ...ledger,
      movements,
      lines: ledger.lines ?? movements,
      hasMore: ledger.hasMore ?? !!ledger.nextCursor,
    };
  });

export type ThirdPartyLedgerDto = z.infer<typeof ThirdPartyLedgerDtoSchema>;

export const ThirdPartyLedgerResponseSchema = z.object({
  message: z.unknown().optional(),
  data: ThirdPartyLedgerDtoSchema,
});

export const ThirdPartyBalanceQuerySchema = z.object({
  fiscalYear: z.string().regex(/^\d{4}$/),
  accountId: z.string().regex(/^\d{2,8}$/),
  thirdPartyType: ThirdPartyType,
  status: ThirdPartyStatus.optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100).optional(),
  cursor: z.string().optional(),
}).superRefine((query, context) => {
  if (query.startDate && !query.startDate.startsWith(`${query.fiscalYear}-`)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Start date must belong to the fiscal year",
      path: ["startDate"],
    });
  }

  if (query.endDate && !query.endDate.startsWith(`${query.fiscalYear}-`)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "End date must belong to the fiscal year",
      path: ["endDate"],
    });
  }

  if (query.startDate && query.endDate && query.startDate > query.endDate) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Start date must not be after end date",
      path: ["endDate"],
    });
  }
});

export type ThirdPartyBalanceQuery = z.infer<
  typeof ThirdPartyBalanceQuerySchema
>;

export const ThirdPartyBalanceLineDtoSchema = z.object({
  thirdPartyId: z.string().min(1),
  thirdPartyType: ThirdPartyType,
  thirdPartyCode: z.string().min(1),
  thirdPartyName: z.string().min(1),
  accountId: z.string().regex(/^\d{8}$/),
  accountCode: z.string().regex(/^\d{8}$/),
  accountLabel: z.string().min(1),
  openingDebit: z.number().int().nonnegative(),
  openingCredit: z.number().int().nonnegative(),
  movementDebit: z.number().int().nonnegative(),
  movementCredit: z.number().int().nonnegative(),
  closingDebit: z.number().int().nonnegative(),
  closingCredit: z.number().int().nonnegative(),
  balance: z.number().int(),
  unletteredAmount: z.number().int().nonnegative().optional(),
  remainingAmount: z.number().int().nonnegative().optional(),
  letteringStatusSummary: z
    .object({
      unlettered: z.number().int().nonnegative(),
      partial: z.number().int().nonnegative(),
      lettered: z.number().int().nonnegative(),
      remainingAmount: z.number().int().nonnegative(),
    })
    .optional(),
});

export const ThirdPartyBalanceDtoSchema = z
  .object({
    accountId: z.string().regex(/^\d{8}$/),
    thirdPartyType: ThirdPartyType,
    account: AccountDtoSchema,
    period: z.object({
      fiscalYear: z.string().regex(/^\d{4}$/),
      startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }),
    rows: z.array(ThirdPartyBalanceLineDtoSchema),
    summary: z.object({
      totalOpeningDebit: z.number().int().nonnegative(),
      totalOpeningCredit: z.number().int().nonnegative(),
      totalMovementDebit: z.number().int().nonnegative(),
      totalMovementCredit: z.number().int().nonnegative(),
      totalClosingDebit: z.number().int().nonnegative(),
      totalClosingCredit: z.number().int().nonnegative(),
      thirdPartyCount: z.number().int().nonnegative(),
      balance: z.number().int(),
    }),
    count: z.number().int().nonnegative(),
    nextCursor: z.string().optional(),
    hasMore: z.boolean().optional(),
  })
  .transform((balance) => ({
    ...balance,
    hasMore: balance.hasMore ?? !!balance.nextCursor,
  }));

export type ThirdPartyBalanceLineDto = z.infer<
  typeof ThirdPartyBalanceLineDtoSchema
>;
export type ThirdPartyBalanceDto = z.infer<typeof ThirdPartyBalanceDtoSchema>;

export const ThirdPartyBalanceResponseSchema = z.object({
  message: z.unknown().optional(),
  data: ThirdPartyBalanceDtoSchema,
});

export const MatchingReportDtoSchema = z.object({
  accountId: z.string(),
  thirdPartyId: z.string(),
  summary: z.object({
    totalDebit: z.number().int().nonnegative(),
    totalCredit: z.number().int().nonnegative(),
    balance: z.number().int(),
  }),
  letteredGroups: z.record(z.string(), z.array(AccountEntryDtoSchema)),
  unletteredLines: z.array(AccountEntryDtoSchema),
});

export type MatchingReportDto = z.infer<typeof MatchingReportDtoSchema>;

export const MatchingReportResponseSchema = z.object({
  message: z.unknown().optional(),
  data: MatchingReportDtoSchema,
});

export const LetteringSuggestionLineDtoSchema = z.object({
  lineId: z.string(),
  entryId: z.string(),
  date: z.string(),
  label: z.string().optional(),
  amount: z.number().int().nonnegative(),
  type: z.enum(["DEBIT", "CREDIT"]).optional(),
  projectId: z.string().optional(),
});

export const LetteringSuggestionDtoSchema = z.object({
  type: z.enum(["PERFECT_MATCH", "FIFO_SUGGESTION"]),
  amount: z.number().int().nonnegative(),
  lines: z.array(LetteringSuggestionLineDtoSchema).min(2),
});

export const UnletteredLinesDtoSchema = z.object({
  totalUnlettered: z.number().int().nonnegative(),
  suggestionsFound: z.number().int().nonnegative(),
  unletteredLines: z.array(AccountEntryDtoSchema),
  suggestions: z.array(LetteringSuggestionDtoSchema),
});

export type LetteringSuggestionDto = z.infer<
  typeof LetteringSuggestionDtoSchema
>;
export type UnletteredLinesDto = z.infer<typeof UnletteredLinesDtoSchema>;

export const UnletteredLinesResponseSchema = z.object({
  message: z.unknown().optional(),
}).and(UnletteredLinesDtoSchema);

export const LetteringStatus = z.enum(["UNLETTERED", "PARTIAL", "LETTERED"]);
export type LetteringStatusValue = z.infer<typeof LetteringStatus>;

const LetteringLineAmountSchema = z.number().int().nonnegative();
const PositiveLetteringAmountSchema = z.number().int().positive();

export const UnletteredLineDtoSchema = z
  .object({
    entryId: z.string().min(1),
    lineId: z.string().min(1),
    stableLineIndex: z.number().int().positive().optional(),
    fiscalYear: z.number().int(),
    accountingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    journalCode: z.string().min(1),
    entryNumber: z.string().min(1),
    reference: z.string().optional(),
    accountId: z.string().regex(/^\d{8}$/),
    accountCode: z.string().regex(/^\d{8}$/).optional(),
    accountLabel: z.string().optional(),
    thirdPartyId: z.string().min(1),
    thirdPartyType: ThirdPartyType,
    thirdPartyCode: z.string().optional(),
    thirdPartyName: z.string().optional(),
    label: z.string().optional(),
    debit: LetteringLineAmountSchema,
    credit: LetteringLineAmountSchema,
    originalAmount: PositiveLetteringAmountSchema,
    letteredAmount: LetteringLineAmountSchema,
    remainingAmount: PositiveLetteringAmountSchema,
    letteringStatus: LetteringStatus,
    letteringMatchIds: z.array(z.string().min(1)).max(50).optional(),
  })
  .refine((line) => !(line.debit > 0 && line.credit > 0), {
    message: "A line cannot have both debit and credit amounts",
    path: ["debit"],
  })
  .refine((line) => line.letteredAmount + line.remainingAmount <= line.originalAmount, {
    message: "Lettered and remaining amounts cannot exceed the original amount",
    path: ["remainingAmount"],
  });

export type UnletteredLineDto = z.infer<typeof UnletteredLineDtoSchema>;

export const LetteringCandidatesQuerySchema = z.object({
  fiscalYear: z.coerce.number().int().gte(1900),
  accountId: z.string().regex(/^\d{2,8}$/),
  thirdPartyId: z.string().min(1),
  thirdPartyType: ThirdPartyType,
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50).optional(),
}).superRefine((query, context) => {
  if (query.dateFrom && query.dateTo && query.dateFrom > query.dateTo) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "dateFrom must not be after dateTo",
      path: ["dateTo"],
    });
  }
});

export type LetteringCandidatesQuery = z.infer<
  typeof LetteringCandidatesQuerySchema
>;

export const LetteringCandidatesDtoSchema = z.object({
  accountId: z.string().regex(/^\d{8}$/),
  accountCode: z.string().regex(/^\d{8}$/).optional(),
  thirdPartyId: z.string().min(1),
  thirdPartyType: ThirdPartyType,
  thirdPartyName: z.string().optional(),
  lines: z.array(UnletteredLineDtoSchema),
  nextCursor: z.string().optional(),
  hasMore: z.boolean(),
});

export type LetteringCandidatesDto = z.infer<
  typeof LetteringCandidatesDtoSchema
>;

export const LetteringCandidatesResponseSchema = z.object({
  message: z.unknown().optional(),
  data: LetteringCandidatesDtoSchema,
});

export const LetteringAllocationRequestSchema = z.object({
  entryId: z.string().min(1),
  lineId: z.string().min(1),
  amount: PositiveLetteringAmountSchema,
});

export const CreateLetteringMatchRequestSchema = z.object({
  accountId: z.string().regex(/^\d{2,8}$/),
  thirdPartyId: z.string().min(1),
  thirdPartyType: ThirdPartyType,
  fiscalYear: z.coerce.number().int().gte(1900),
  allocations: z.array(LetteringAllocationRequestSchema).min(2).max(49),
  note: z.string().trim().max(500).optional(),
});

export type CreateLetteringMatchRequest = z.infer<
  typeof CreateLetteringMatchRequestSchema
>;

export const LetteringMatchAllocationDtoSchema = z.object({
  entryId: z.string().min(1),
  lineId: z.string().min(1),
  accountingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  journalCode: z.string().min(1),
  entryNumber: z.string().optional(),
  reference: z.string().optional(),
  label: z.string().optional(),
  debit: LetteringLineAmountSchema,
  credit: LetteringLineAmountSchema,
  allocatedAmount: PositiveLetteringAmountSchema,
}).refine((line) => !(line.debit > 0 && line.credit > 0), {
  message: "A line cannot have both debit and credit amounts",
  path: ["debit"],
});

export type LetteringMatchAllocationDto = z.infer<
  typeof LetteringMatchAllocationDtoSchema
>;

export const LetteringMatchDtoSchema = z.object({
  letteringId: z.string().min(1),
  fiscalYear: z.number().int(),
  accountId: z.string().regex(/^\d{8}$/),
  accountCode: z.string().regex(/^\d{8}$/).optional(),
  thirdPartyId: z.string().min(1),
  thirdPartyType: ThirdPartyType,
  status: z.enum(["ACTIVE", "CANCELLED"]),
  totalDebit: LetteringLineAmountSchema,
  totalCredit: LetteringLineAmountSchema,
  createdAt: z.string(),
  createdBy: z.string().optional(),
  cancelledAt: z.string().optional(),
  cancelledBy: z.string().optional(),
  cancellationReason: z.string().optional(),
  note: z.string().optional(),
  allocations: z.array(LetteringMatchAllocationDtoSchema).min(1),
});

export type LetteringMatchDto = z.infer<typeof LetteringMatchDtoSchema>;

export const LetteringMatchResponseSchema = z.object({
  message: z.unknown().optional(),
  data: LetteringMatchDtoSchema,
});

export const GetLetteringMatchRequestSchema = z.object({
  fiscalYear: z.coerce.number().int().gte(1900),
  letteringId: z.string().min(1),
});

export const CancelLetteringMatchRequestSchema = GetLetteringMatchRequestSchema.extend({
  cancellationReason: z.string().trim().max(500).optional(),
});

export type GetLetteringMatchRequest = z.infer<
  typeof GetLetteringMatchRequestSchema
>;
export type CancelLetteringMatchRequest = z.infer<
  typeof CancelLetteringMatchRequestSchema
>;

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
  letteringStatus: LineLetteringStatus.optional(),
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
  label: z.string().optional(),
  totalDebit: MoneySchema,
  totalCredit: MoneySchema,
  status: EntryStatus,
  lineIds: z.array(z.string()).optional(),
  postedBy: z.string().optional(),
  postedAt: z.string().optional(),
  entityType: z.literal("ENTRY"),
  PK: z.string(),
  SK: z.string(),
  GSI5PK: z.string().optional(),
  GSI5SK: z.string().optional(),
  GSI7PK: z.string().optional(),
  GSI7SK: z.string().optional(),
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
  accountCode: z.string().regex(/^\d{8}$/).optional(),
  accountLabel: z.string().optional(),
  postingOrdinal: z.number().int().positive().optional(),
  projectId: z.string().optional(),
  budgetLineId: z.string().optional(),
  thirdPartyId: z.string().optional(),
  thirdPartyType: ThirdPartyType.optional(),
  thirdPartyCode: z.string().optional(),
  thirdPartyName: z.string().optional(),
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
  letteringStatus: LineLetteringStatus.optional(),
  letteredAmount: z.number().int().nonnegative().optional(),
  remainingAmount: z.number().int().nonnegative().optional(),
  letteringMatchIds: z.array(z.string().min(1)).max(50).optional(),
  entityType: z.literal("ENTRY_LINE"),

  // Database Keys (DynamoDB + KeyFactory)
  PK: z.string(),
  SK: z.string(),

  // Index Keys (GSI 1, 2, 3, 4). Draft lines intentionally have no ledger indexes.
  GSI1PK: z.string().optional(),
  GSI1SK: z.string().optional(),
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
