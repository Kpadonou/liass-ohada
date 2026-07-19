import { createAuthenticatedHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { OnboardingService } from "@/lambda/shared/services/onboarding-service";
import { UserProfileService } from "@/lambda/shared/services/user-profile-service";
import { CreateInitialWorkspaceRequestSchema } from "@liass-ohada/shared";

export const handler = createAuthenticatedHandler(
  CreateInitialWorkspaceRequestSchema,
  async (data, context) => {
    const claims = context.event.requestContext.authorizer.jwt.claims;
    await UserProfileService.ensureSynchronized({
      userId: context.userId,
      email: claims.email,
      emailVerified: claims.email_verified,
      displayName: claims.name,
      givenName: claims.given_name,
      familyName: claims.family_name,
      avatarUrl: claims.picture,
    });
    return OnboardingService.createInitialWorkspace(context.userId, data);
  },
);
