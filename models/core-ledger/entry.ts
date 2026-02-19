import { z } from "zod";

// --- Enums & Constants ---

export const AccountingStandard = z.enum(["SYSCOHADA_GENERAL", "SYCEBNL"]);
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
    thirdPartyId: z.string().optional(),
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
  accountingStandard: AccountingStandard.default("SYSCOHADA_GENERAL"),
  entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  journalCode: z.string().min(1).max(10),
  voucherNumber: z.string().optional(),
  entryId: z.string().optional(),
  entryType: EntryType.default("STANDARD"),
  label: z.string().min(3).max(255),
  currency: z.string().optional(),
  lines: z.array(EntryLineInputSchema).min(2),
});

export type CreateEntryRequest = z.infer<typeof CreateEntryRequestSchema>;

// --- Persistence Schemas (DynamoDB Items) ---

/**
 * Entry Header Item (PK: ORG#{orgId}#FY#{year}, SK: ENT#{entryId})
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
  createdBy: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Entry = z.infer<typeof EntrySchema>;

/**
 * Entry Line Item (PK: ORG#{orgId}#FY#{year}, SK: ENT#{entryId}#LIN#{lineId})
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
  thirdPartyId: z.string().optional(),
  debit: MoneySchema,
  credit: MoneySchema,
  label: z.string().optional(),
  description: z.string().optional(),
  entryDate: z.string(),
  journalCode: z.string(),
  voucherNumber: z.string().optional(),

  // Metadata
  letteringCode: z.string().optional(),
  entityType: z.literal("ENTRY_LINE"),

  // Database Keys (DynamoDB + KeyFactory)
  PK: z.string(),
  SK: z.string(),

  // Index Keys (GSI 1, 2, 3, 4)
  GSI1PK: z.string(),
  GSI1SK: z.string(),
  GSI2PK: z.string().optional(),
  GSI2SK: z.string().optional(),
  L_PK: z.string().optional(), // Pour GSI_LETTERING
  L_SK: z.string().optional(), // Pour GSI_LETTERING
  GSI4PK: z.string().optional(), // Pour GSI_PROJECT (SYCEBNL)
  GSI4SK: z.string().optional(), // Pour GSI_PROJECT (SYCEBNL)

  createdBy: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type EntryLine = z.infer<typeof EntryLineSchema>;
