import { createCabinetHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { CabinetOperationsService } from "@/lambda/shared/services/cabinet-operations-service";
import { ListAccountingWorksRequestSchema } from "@liass-ohada/shared";

export const handler = createCabinetHandler(
  ListAccountingWorksRequestSchema,
  async (data, context) =>
    CabinetOperationsService.listWorks(
      {
        orgId: context.orgId,
        userId: context.userId,
        cabinetId: context.cabinetId,
        workspaceType: context.workspaceType,
      },
      data,
    ),
);
