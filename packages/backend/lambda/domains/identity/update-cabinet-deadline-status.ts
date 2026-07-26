import { createCabinetHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { CabinetOperationsService } from "@/lambda/shared/services/cabinet-operations-service";
import { UpdateCabinetDeadlineStatusRequestSchema } from "@liass-ohada/shared";

export const handler = createCabinetHandler(
  UpdateCabinetDeadlineStatusRequestSchema,
  async (data, context) =>
    CabinetOperationsService.updateDeadlineStatus(
      {
        orgId: context.orgId,
        userId: context.userId,
        cabinetId: context.cabinetId,
        workspaceType: context.workspaceType,
      },
      data,
    ),
);
