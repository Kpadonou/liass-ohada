import { createCabinetHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { CabinetOperationsService } from "@/lambda/shared/services/cabinet-operations-service";
import { UpdateCabinetDeadlineRequestSchema } from "@liass-ohada/shared";

export const handler = createCabinetHandler(
  UpdateCabinetDeadlineRequestSchema,
  async (data, context) =>
    CabinetOperationsService.updateDeadline(
      {
        orgId: context.orgId,
        userId: context.userId,
        cabinetId: context.cabinetId,
        workspaceType: context.workspaceType,
      },
      data,
    ),
);
