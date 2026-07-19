import { createCabinetHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { CabinetTeamService } from "@/lambda/shared/services/cabinet-team-service";
import { z } from "zod";

export const handler = createCabinetHandler(
  z.object({ dossierOrgId: z.string().min(1) }).strict(),
  (data, context) =>
    CabinetTeamService.listDossierMembers(context, data.dossierOrgId),
);
