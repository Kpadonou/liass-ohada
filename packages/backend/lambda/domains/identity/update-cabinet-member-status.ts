import { createCabinetHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { CabinetTeamService } from "@/lambda/shared/services/cabinet-team-service";
import { UpdateCabinetMemberStatusRequestSchema } from "@liass-ohada/shared";
import { z } from "zod";

const RequestSchema = UpdateCabinetMemberStatusRequestSchema.extend({
  memberUserId: z.string().min(1),
});

export const handler = createCabinetHandler(RequestSchema, (data, context) =>
  CabinetTeamService.updateMemberStatus(context, data.memberUserId, {
    status: data.status,
  }),
);
