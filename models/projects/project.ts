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
  startDate: z.string(),
  endDate: z.string().optional(),
  budget: z.number().int(),
  currency: z.string().default("XOF"), // Multi-currency support
  currentSpending: z.number().int().default(0),

  status: ProjectStatus,
  entityType: z.literal("PROJECT"),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Project = z.infer<typeof ProjectSchema>;
