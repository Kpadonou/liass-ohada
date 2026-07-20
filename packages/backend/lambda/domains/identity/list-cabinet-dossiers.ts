import { createCabinetHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { CabinetDossierService } from "@/lambda/shared/services/cabinet-dossier-service";
import { ListCabinetDossiersRequestSchema } from "@liass-ohada/shared";

export const handler = createCabinetHandler(ListCabinetDossiersRequestSchema, async (data, context) =>
  CabinetDossierService.listClientDossiers({
    orgId: context.orgId,
    userId: context.userId,
    cabinetId: context.cabinetId,
    workspaceType: context.workspaceType,
  }, data),
);
