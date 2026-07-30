import { createCabinetHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { CabinetSettingsService } from "@/lambda/shared/services/cabinet-settings-service";
import { UpdateCabinetSettingsRequestSchema } from "@liass-ohada/shared/shared";

export const handler = createCabinetHandler(
  UpdateCabinetSettingsRequestSchema,
  async (data, context) =>
    CabinetSettingsService.updateSettings(
      {
        orgId: context.orgId,
        userId: context.userId,
        cabinetId: context.cabinetId,
        workspaceType: context.workspaceType,
        cabinetRole: context.cabinetRole,
      },
      data,
    ),
);
