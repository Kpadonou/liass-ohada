import { createAuthenticatedHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { CabinetInvitationService } from "@/lambda/shared/services/cabinet-invitation-service";
import { AcceptCabinetInvitationRequestSchema } from "@liass-ohada/shared";

export const handler = createAuthenticatedHandler(
  AcceptCabinetInvitationRequestSchema,
  (data, context) => {
    const claims = context.event.requestContext.authorizer.jwt.claims;
    return CabinetInvitationService.acceptInvitation(data.token, {
      userId: context.userId,
      email: claims.email,
      emailVerified: claims.email_verified,
      displayName: claims.name,
      givenName: claims.given_name,
      familyName: claims.family_name,
    });
  },
);
