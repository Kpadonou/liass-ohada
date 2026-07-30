import { createCabinetHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { CabinetSettingsService } from "@/lambda/shared/services/cabinet-settings-service";
import { GetCabinetSettingsRequestSchema } from "@liass-ohada/shared/shared";

export const handler = createCabinetHandler(
  GetCabinetSettingsRequestSchema,
  async (_data, context) =>
    CabinetSettingsService.getSettings({
      orgId: context.orgId,
      userId: context.userId,
      cabinetId: context.cabinetId,
      workspaceType: context.workspaceType,
      cabinetRole: context.cabinetRole,
    }),
);
