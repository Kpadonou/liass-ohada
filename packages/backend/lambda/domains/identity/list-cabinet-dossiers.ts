import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { CabinetDossierService } from "@/lambda/shared/services/cabinet-dossier-service";
import { z } from "zod";

export const handler = createHandler(z.object({}).strict(), async (_data, context) =>
  CabinetDossierService.listClientDossiers({
    orgId: context.orgId,
    userId: context.userId,
    cabinetId: context.cabinetId,
    workspaceType: context.workspaceType,
  }),
);
