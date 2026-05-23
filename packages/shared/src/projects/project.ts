import { z } from "zod";

export const ProjectStatus = z.enum([
  "ACTIVE",
  "COMPLETED",
  "ON_HOLD",
  "CANCELLED",
]);

export const ProjectSchema = z.object({
  orgId: z.string(),
  projectId: z.string(), // Technical ID (Internal link)
  projectCode: z.string(), // Business Code (Human reference)
  name: z.string(),
  description: z.string().optional(),

  // Funding context
  donorId: z.string(), // Linked to Third-Party
  managerId: z.string(), // Responsible user
  contractRef: z.string().optional(), // Funder's contract number

  // Financials
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // YYYY-MM-DD
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  totalBudget: z.number().int(),
  annualBudgets: z.record(z.string(), z.number().min(0)).default({}),
  currency: z.string().default("XOF"), // Multi-currency support
  currentSpending: z.number().int().default(0),

  status: ProjectStatus.default("ACTIVE"),
  entityType: z.literal("PROJECT"),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Project = z.infer<typeof ProjectSchema>;
