import { z } from "zod";

// 1. La Ligne Budgétaire (L'atome du budget)
export const BudgetLineSchema = z.object({
  entityType: z.literal("BUDGET_LINE"),
  projectId: z.string(),
  fiscalYear: z.string(),
  code: z.string(), // ex: "ACT-1.1"
  label: z.string(), // ex: "Achat de semences"
  amount: z.number().min(0), // Montant alloué
  category: z.enum(["PERSONNEL", "EQUIPMENT", "FUNCTIONING", "ACTIVITY"]),
});

export const BudgetLineDtoSchema = BudgetLineSchema.omit({
  entityType: true,
});

export type BudgetLineDto = z.infer<typeof BudgetLineDtoSchema>;

export const CreateBudgetLineRequestSchema = z.object({
  fiscalYear: z.string().regex(/^\d{4}$/),
  code: z.string().min(1).max(40),
  label: z.string().min(1),
  amount: z.number().int().nonnegative(),
  category: z.enum(["PERSONNEL", "EQUIPMENT", "FUNCTIONING", "ACTIVITY"]),
});

export type CreateBudgetLineRequest = z.infer<
  typeof CreateBudgetLineRequestSchema
>;

// 2. Le Header du Budget (L'enveloppe)
export const BudgetSchema = z.object({
  entityType: z.literal("BUDGET"),
  projectId: z.string(),
  fiscalYear: z.string(),
  status: z.enum(["DRAFT", "APPROVED", "REVISED"]),
  totalAmount: z.number().min(0),
  currency: z.string().default("XOF"),
  updatedAt: z.string().datetime(),
});

export type BudgetLine = z.infer<typeof BudgetLineSchema>;
export type Budget = z.infer<typeof BudgetSchema>;

export const BudgetLineResponseSchema = z.object({
  message: z.unknown().optional(),
  data: BudgetLineDtoSchema,
});

export const ListBudgetLinesResponseSchema = z.object({
  message: z.unknown().optional(),
  data: z.object({
    budgetLines: z.array(BudgetLineDtoSchema),
  }),
});
