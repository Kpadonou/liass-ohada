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
