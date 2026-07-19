import { createCabinetHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { CabinetTeamService } from "@/lambda/shared/services/cabinet-team-service";
import { ReplaceCabinetMemberAssignmentsRequestSchema } from "@liass-ohada/shared";
import { z } from "zod";

const RequestSchema = ReplaceCabinetMemberAssignmentsRequestSchema.extend({
  memberUserId: z.string().min(1),
});

export const handler = createCabinetHandler(RequestSchema, (data, context) =>
  CabinetTeamService.replaceMemberAssignments(context, data.memberUserId, {
    dossierOrgIds: data.dossierOrgIds,
  }),
);
