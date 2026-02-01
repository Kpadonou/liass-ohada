import { z } from "zod";

export const ProjectStatus = z.enum([
  "ACTIVE",
  "CLOSED",
  "SUSPENDED",
  "PROPOSED",
]);

export const ProjectSchema = z.object({
  orgId: z.string(),
  projectId: z.string(),
  projectCode: z.string(),
  name: z.string(),
  description: z.string().optional(),
  donorId: z.string(),
  startDate: z.string(), // ISO Date
  endDate: z.string().optional(), // ISO Date
  status: ProjectStatus,
  totalBudget: z.number(),
  currency: z.string(), // ISO 4217
  managerId: z.string(),
  entityType: z.literal("PROJECT"),
  PK: z.string(),
  SK: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Project = z.infer<typeof ProjectSchema>;
