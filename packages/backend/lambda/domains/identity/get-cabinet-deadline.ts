import { createCabinetHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { CabinetOperationsService } from "@/lambda/shared/services/cabinet-operations-service";
import { z } from "zod";

const GetCabinetDeadlineRequestSchema = z
  .object({ deadlineId: z.string().min(1) })
  .strict();

export const handler = createCabinetHandler(
  GetCabinetDeadlineRequestSchema,
  async (data, context) =>
    CabinetOperationsService.getDeadline(
      {
        orgId: context.orgId,
        userId: context.userId,
        cabinetId: context.cabinetId,
        workspaceType: context.workspaceType,
      },
      data.deadlineId,
    ),
);
