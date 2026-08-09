import { z } from "zod";

const MoneySchema = z.number().int();
const NonNegativeMoneySchema = z.number().int().nonnegative();
const PositiveMoneySchema = z.number().int().positive();
const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const YearSchema = z.string().regex(/^\d{4}$/);

export const TreasuryAccountType = z.enum(["BANK", "CASH", "MOBILE_MONEY"]);
export const TreasuryTransactionDirection = z.enum(["INFLOW", "OUTFLOW"]);
export const BankStatementLineDirection = TreasuryTransactionDirection;
export const BankStatementLineStatus = z.enum([
  "UNMATCHED",
  "MATCHED",
  "IGNORED",
]);
export const ReconciliationStatus = z.enum(["ACTIVE", "CANCELLED"]);

export const TreasuryAccountSchema = z.object({
  orgId: z.string(),
  treasuryAccountId: z.string(),
  accountId: z.string().regex(/^5\d{7}$/),
  label: z.string().min(1),
  type: TreasuryAccountType,
  currency: z.string().length(3).default("XOF"),
  bankName: z.string().optional(),
  bankAccountNumber: z.string().optional(),
  openingBalance: MoneySchema.default(0),
  active: z.boolean().default(true),
  entityType: z.literal("TREASURY_ACCOUNT"),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type TreasuryAccount = z.infer<typeof TreasuryAccountSchema>;

export const TreasuryAccountDtoSchema = TreasuryAccountSchema.omit({
  entityType: true,
});

export type TreasuryAccountDto = z.infer<typeof TreasuryAccountDtoSchema>;

export const CreateTreasuryAccountRequestSchema = z.object({
  accountId: z.string().regex(/^\d{8}$/),
  label: z.string().min(1),
  type: TreasuryAccountType,
  currency: z.string().length(3).default("XOF"),
  bankName: z.string().optional(),
  bankAccountNumber: z.string().optional(),
  openingBalance: MoneySchema.default(0),
});

export type CreateTreasuryAccountRequest = z.infer<
  typeof CreateTreasuryAccountRequestSchema
>;

export const ListTreasuryAccountsRequestSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100).optional(),
  cursor: z.string().optional(),
});

export type ListTreasuryAccountsRequest = z.infer<
  typeof ListTreasuryAccountsRequestSchema
>;

export const TreasuryMovementDtoSchema = z.object({
  treasuryAccountId: z.string(),
  accountId: z.string().regex(/^5\d{7}$/),
  entryId: z.string(),
  lineId: z.string(),
  date: DateSchema,
  journalCode: z.string(),
  label: z.string(),
  reference: z.string(),
  debit: NonNegativeMoneySchema,
  credit: NonNegativeMoneySchema,
  amount: NonNegativeMoneySchema,
  direction: TreasuryTransactionDirection,
  runningBalance: MoneySchema,
  statementLineId: z.string().optional(),
  reconciliationMatchId: z.string().optional(),
  reconciliationStatus: z.enum(["UNMATCHED", "MATCHED"]).default("UNMATCHED"),
});

export type TreasuryMovementDto = z.infer<typeof TreasuryMovementDtoSchema>;

export const CreateTreasuryTransactionRequestSchema = z.object({
  clientRequestId: z.string().uuid(),
  treasuryAccountId: z.string().min(1),
  year: z.number().int(),
  entryDate: DateSchema,
  journalCode: z.string().min(1).max(10).default("BANK"),
  direction: TreasuryTransactionDirection,
  amount: NonNegativeMoneySchema,
  counterpartyAccountId: z.string().regex(/^\d{8}$/),
  label: z.string().min(3).max(255),
  voucherNumber: z.string().optional(),
  thirdPartyId: z.string().optional(),
  projectId: z.string().optional(),
  budgetLineId: z.string().optional(),
  donorId: z.string().optional(),
});

export type CreateTreasuryTransactionRequest = z.infer<
  typeof CreateTreasuryTransactionRequestSchema
>;

export const BankStatementLineSchema = z.object({
  orgId: z.string(),
  treasuryAccountId: z.string(),
  statementLineId: z.string(),
  year: YearSchema,
  statementDate: DateSchema,
  date: DateSchema,
  valueDate: DateSchema.optional(),
  reference: z.string().optional(),
  externalId: z.string().optional(),
  description: z.string().min(1),
  label: z.string().min(1),
  amount: PositiveMoneySchema,
  direction: BankStatementLineDirection,
  currency: z.string().length(3).default("XOF"),
  status: BankStatementLineStatus.default("UNMATCHED"),
  matchedEntryId: z.string().optional(),
  matchedLineId: z.string().optional(),
  reconciliationMatchId: z.string().optional(),
  rawData: z.record(z.string(), z.unknown()).optional(),
  importedAt: z.string(),
  entityType: z.literal("BANK_STATEMENT_LINE"),
});

export type BankStatementLine = z.infer<typeof BankStatementLineSchema>;

export const BankStatementLineDtoSchema = BankStatementLineSchema.omit({
  entityType: true,
  orgId: true,
});

export type BankStatementLineDto = z.infer<typeof BankStatementLineDtoSchema>;

export const ImportBankStatementLineSchema = z.object({
  statementDate: DateSchema,
  valueDate: DateSchema.optional(),
  reference: z.string().optional(),
  externalId: z.string().optional(),
  description: z.string().min(1),
  amount: PositiveMoneySchema,
  direction: BankStatementLineDirection,
  currency: z.string().length(3).default("XOF"),
  rawData: z.record(z.string(), z.unknown()).optional(),
});

export type ImportBankStatementLine = z.infer<
  typeof ImportBankStatementLineSchema
>;

export const ListBankStatementLinesRequestSchema = z
  .object({
    treasuryAccountId: z.string().min(1),
    year: YearSchema,
    limit: z.coerce.number().int().min(1).max(200).default(100).optional(),
    cursor: z.string().optional(),
    status: BankStatementLineStatus.optional(),
    direction: BankStatementLineDirection.optional(),
    startDate: DateSchema.optional(),
    endDate: DateSchema.optional(),
  })
  .refine(
    (data) =>
      !data.startDate || !data.endDate || data.startDate <= data.endDate,
    {
      message: "INVALID_BANK_STATEMENT_LINE_DATE_RANGE",
      path: ["endDate"],
    },
  );

export type ListBankStatementLinesRequest = z.infer<
  typeof ListBankStatementLinesRequestSchema
>;

export const ImportBankStatementRequestSchema = z.object({
  year: YearSchema,
  lines: z.array(ImportBankStatementLineSchema).min(1).max(500),
});

export type ImportBankStatementRequest = z.infer<
  typeof ImportBankStatementRequestSchema
>;

export const ReconciliationMatchSchema = z.object({
  orgId: z.string(),
  treasuryAccountId: z.string(),
  matchId: z.string(),
  year: YearSchema,
  statementLineId: z.string(),
  statementDate: DateSchema,
  movementLineId: z.string(),
  entryId: z.string().optional(),
  lineId: z.string().optional(),
  amount: PositiveMoneySchema,
  direction: BankStatementLineDirection,
  status: ReconciliationStatus.default("ACTIVE"),
  matchedAt: z.string(),
  matchedBy: z.string(),
  cancelledAt: z.string().optional(),
  cancelledBy: z.string().optional(),
  cancelReason: z.string().optional(),
  statementReference: z.string().optional(),
  statementDescription: z.string().optional(),
  entityType: z.literal("RECONCILIATION_MATCH"),
});

export type ReconciliationMatch = z.infer<typeof ReconciliationMatchSchema>;

export const ReconciliationMatchDtoSchema = ReconciliationMatchSchema.omit({
  entityType: true,
  orgId: true,
});

export type ReconciliationMatchDto = z.infer<
  typeof ReconciliationMatchDtoSchema
>;

export const CreateReconciliationRequestSchema = z
  .object({
    treasuryAccountId: z.string().min(1),
    year: YearSchema,
    statementLineId: z.string().min(1),
    statementDate: DateSchema,
    movementLineId: z.string().min(1).optional(),
    entryId: z.string().min(1).optional(),
    lineId: z.string().min(1).optional(),
  })
  .refine((data) => data.movementLineId || data.lineId, {
    message: "INVALID_RECONCILIATION_REQUEST",
    path: ["movementLineId"],
  });

export type CreateReconciliationRequest = z.infer<
  typeof CreateReconciliationRequestSchema
>;

export const CancelReconciliationRequestSchema = z.object({
  matchId: z.string().min(1),
  treasuryAccountId: z.string().min(1),
  year: YearSchema,
  cancelReason: z.string().min(1).max(255).optional(),
});

export type CancelReconciliationRequest = z.infer<
  typeof CancelReconciliationRequestSchema
>;

export const ListReconciliationMatchesRequestSchema = z.object({
  treasuryAccountId: z.string().min(1),
  year: YearSchema,
  status: ReconciliationStatus.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100).optional(),
  cursor: z.string().optional(),
});

export type ListReconciliationMatchesRequest = z.infer<
  typeof ListReconciliationMatchesRequestSchema
>;

export const TreasurySummaryDtoSchema = z.object({
  year: YearSchema,
  accountsCount: z.number().int().nonnegative(),
  totalInflows: NonNegativeMoneySchema,
  totalOutflows: NonNegativeMoneySchema,
  netCashFlow: MoneySchema,
  unreconciledStatementLines: z.number().int().nonnegative(),
  unreconciledMovements: z.number().int().nonnegative(),
});

export type TreasurySummaryDto = z.infer<typeof TreasurySummaryDtoSchema>;

export const TreasuryAccountResponseSchema = z.object({
  message: z.unknown().optional(),
  data: TreasuryAccountDtoSchema,
});

export const ListTreasuryAccountsResponseSchema = z.object({
  message: z.unknown().optional(),
  data: z.object({
    accounts: z.array(TreasuryAccountDtoSchema),
    nextCursor: z.string().optional(),
    hasMore: z.boolean().default(false).optional(),
    count: z.number().int().nonnegative().optional(),
  }),
});

export const ListTreasuryMovementsResponseSchema = z.object({
  message: z.unknown().optional(),
  data: z.object({
    movements: z.array(TreasuryMovementDtoSchema),
  }),
});

export const TreasuryTransactionResponseSchema = z.object({
  message: z.unknown().optional(),
  data: z.object({
    entryId: z.string(),
  }),
});

export const ListBankStatementLinesResponseSchema = z.object({
  message: z.unknown().optional(),
  data: z.object({
    statementLines: z.array(BankStatementLineDtoSchema),
    nextCursor: z.string().optional(),
    hasMore: z.boolean().default(false).optional(),
    count: z.number().int().nonnegative().optional(),
  }),
});

export const ImportBankStatementResponseSchema = z.object({
  message: z.unknown().optional(),
  data: z.object({
    imported: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    rejected: z.number().int().nonnegative().optional(),
    errors: z.array(
      z.object({
        index: z.number().int().nonnegative(),
        message: z.string(),
      }),
    ),
    statementLines: z.array(BankStatementLineDtoSchema),
  }),
});

export const ReconciliationMatchResponseSchema = z.object({
  message: z.unknown().optional(),
  data: ReconciliationMatchDtoSchema,
});

export const CreateReconciliationResponseSchema =
  ReconciliationMatchResponseSchema;

export const CancelReconciliationResponseSchema =
  ReconciliationMatchResponseSchema;

export const ListReconciliationMatchesResponseSchema = z.object({
  message: z.unknown().optional(),
  data: z.object({
    matches: z.array(ReconciliationMatchDtoSchema),
    nextCursor: z.string().optional(),
    hasMore: z.boolean().default(false).optional(),
    count: z.number().int().nonnegative().optional(),
  }),
});

export const TreasurySummaryResponseSchema = z.object({
  message: z.unknown().optional(),
  data: TreasurySummaryDtoSchema,
});
