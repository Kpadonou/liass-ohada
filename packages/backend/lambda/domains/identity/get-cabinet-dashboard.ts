import { createCabinetHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { CabinetDashboardService } from "@/lambda/shared/services/cabinet-dashboard-service";
import { CabinetDashboardRequestSchema } from "@liass-ohada/shared/shared";

export const handler = createCabinetHandler(
  CabinetDashboardRequestSchema,
  async (data, context) =>
    CabinetDashboardService.getDashboard(
      {
        orgId: context.orgId,
        userId: context.userId,
        cabinetId: context.cabinetId,
        workspaceType: context.workspaceType,
      },
      { attentionLimit: data.attentionLimit },
    ),
);
