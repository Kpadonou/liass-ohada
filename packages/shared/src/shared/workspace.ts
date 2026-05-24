import { z } from "zod";

export const WorkspaceSummarySchema = z.object({
  orgId: z.string().min(1),
  role: z.string().optional(),
  cabinetId: z.string().optional(),
  accessSource: z.string().optional(),
  displayName: z.string().optional(),
});

export const WorkspacesResponseSchema = z.object({
  workspaces: WorkspaceSummarySchema.array(),
});

export type WorkspaceSummary = z.infer<typeof WorkspaceSummarySchema>;
export type WorkspacesResponse = z.infer<typeof WorkspacesResponseSchema>;
