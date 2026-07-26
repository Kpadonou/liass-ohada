import { createCabinetHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { CabinetOperationsService } from "@/lambda/shared/services/cabinet-operations-service";
import { UpdateAccountingWorkStatusRequestSchema } from "@liass-ohada/shared";

export const handler = createCabinetHandler(
  UpdateAccountingWorkStatusRequestSchema,
  async (data, context) =>
    CabinetOperationsService.updateWorkStatus(
      {
        orgId: context.orgId,
        userId: context.userId,
        cabinetId: context.cabinetId,
        workspaceType: context.workspaceType,
      },
      data,
    ),
);
