import { createCabinetHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { CabinetTeamService } from "@/lambda/shared/services/cabinet-team-service";
import { UpdateCabinetMemberRoleRequestSchema } from "@liass-ohada/shared";
import { z } from "zod";

const RequestSchema = UpdateCabinetMemberRoleRequestSchema.extend({
  memberUserId: z.string().min(1),
});

export const handler = createCabinetHandler(RequestSchema, (data, context) =>
  CabinetTeamService.updateMemberRole(context, data.memberUserId, {
    role: data.role,
  }),
);
