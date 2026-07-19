import { createCabinetHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { CabinetInvitationService } from "@/lambda/shared/services/cabinet-invitation-service";
import { z } from "zod";

export const handler = createCabinetHandler(
  z.object({ invitationId: z.string().min(1) }).strict(),
  (data, context) =>
    CabinetInvitationService.resendInvitation(context, data.invitationId),
);
