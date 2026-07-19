import { createCabinetHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { CabinetInvitationService } from "@/lambda/shared/services/cabinet-invitation-service";
import { ListCabinetInvitationsRequestSchema } from "@liass-ohada/shared";

export const handler = createCabinetHandler(
  ListCabinetInvitationsRequestSchema,
  (data, context) => CabinetInvitationService.listInvitations(context, data),
);
