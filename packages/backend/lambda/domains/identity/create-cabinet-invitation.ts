import { createCabinetHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { CabinetInvitationService } from "@/lambda/shared/services/cabinet-invitation-service";
import { CreateCabinetInvitationRequestSchema } from "@liass-ohada/shared";

export const handler = createCabinetHandler(
  CreateCabinetInvitationRequestSchema,
  (data, context) => CabinetInvitationService.createInvitation(context, data),
);
