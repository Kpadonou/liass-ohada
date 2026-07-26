import { createCabinetHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { CabinetOperationsService } from "@/lambda/shared/services/cabinet-operations-service";
import { UpdateAccountingWorkRequestSchema } from "@liass-ohada/shared";

export const handler = createCabinetHandler(
  UpdateAccountingWorkRequestSchema,
  async (data, context) =>
    CabinetOperationsService.updateWork(
      {
        orgId: context.orgId,
        userId: context.userId,
        cabinetId: context.cabinetId,
        workspaceType: context.workspaceType,
      },
      data,
    ),
);
