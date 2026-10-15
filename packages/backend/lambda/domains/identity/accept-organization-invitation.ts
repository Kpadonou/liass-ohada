import { AcceptOrganizationInvitationRequestSchema } from "@liass-ohada/shared/shared";
import { createAuthenticatedHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { OrganizationInvitationService } from "@/lambda/shared/services/organization-invitation-service";
export const handler = createAuthenticatedHandler(
  AcceptOrganizationInvitationRequestSchema,
  (data, context) => {
    const claims = context.event.requestContext.authorizer.jwt.claims;
    return OrganizationInvitationService.accept(data, {
      userId: context.userId,
      email: claims.email,
      emailVerified: claims.email_verified,
      displayName: claims.name,
      givenName: claims.given_name,
      familyName: claims.family_name,
    });
  },
);
