import { createCabinetHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { CabinetOperationsService } from "@/lambda/shared/services/cabinet-operations-service";
import { CreateCabinetDeadlineRequestSchema } from "@liass-ohada/shared";

export const handler = createCabinetHandler(
  CreateCabinetDeadlineRequestSchema,
  async (data, context) =>
    CabinetOperationsService.createDeadline(
      {
        orgId: context.orgId,
        userId: context.userId,
        cabinetId: context.cabinetId,
        workspaceType: context.workspaceType,
      },
      data,
    ),
);
