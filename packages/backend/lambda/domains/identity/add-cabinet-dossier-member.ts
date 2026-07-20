import { z } from "zod";
import { createCabinetHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { CabinetTeamService } from "@/lambda/shared/services/cabinet-team-service";

const RequestSchema = z
  .object({
    dossierOrgId: z.string().min(1),
    memberUserId: z.string().min(1),
  })
  .strict();

export const handler = createCabinetHandler(RequestSchema, (data, context) =>
  CabinetTeamService.addDossierAssignment(
    context,
    data.dossierOrgId,
    data.memberUserId,
  ),
);
