import { createCabinetHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { CabinetDossierService } from "@/lambda/shared/services/cabinet-dossier-service";
import { CreateCabinetDossierRequestSchema } from "@liass-ohada/shared";

export const handler = createCabinetHandler(
  CreateCabinetDossierRequestSchema,
  async (data, context) =>
    CabinetDossierService.createClientDossier(
      {
        orgId: context.orgId,
        userId: context.userId,
        cabinetId: context.cabinetId,
        workspaceType: context.workspaceType,
      },
      data,
    ),
);
