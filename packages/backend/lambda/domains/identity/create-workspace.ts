import { createAuthenticatedHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { OnboardingService } from "@/lambda/shared/services/onboarding-service";
import { CreateInitialWorkspaceRequestSchema } from "@liass-ohada/shared";

export const handler = createAuthenticatedHandler(
  CreateInitialWorkspaceRequestSchema,
  async (data, { userId }) => OnboardingService.createInitialWorkspace(userId, data),
);
