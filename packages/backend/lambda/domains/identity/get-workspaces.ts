import { createAuthenticatedHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { TenantAccessService } from "@/lambda/shared/services/tenant-access-service";
import { UserProfileService } from "@/lambda/shared/services/user-profile-service";
import { z } from "zod";

export const handler = createAuthenticatedHandler(
  z.object({}),
  async (_data, context) => {
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
    const workspaces = await TenantAccessService.getUserWorkspaces(context.userId);

    return { workspaces };
  },
);
