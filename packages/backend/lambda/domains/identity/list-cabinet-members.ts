import { createCabinetHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { CabinetTeamService } from "@/lambda/shared/services/cabinet-team-service";
import { ListCabinetMembersRequestSchema } from "@liass-ohada/shared";

export const handler = createCabinetHandler(
  ListCabinetMembersRequestSchema,
  (data, context) => CabinetTeamService.listMembers(context, data),
);
