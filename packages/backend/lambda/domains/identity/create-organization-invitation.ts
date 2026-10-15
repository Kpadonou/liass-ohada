import { CreateOrganizationInvitationRequestSchema } from "@liass-ohada/shared/shared";
import { createPlatformHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { OrganizationInvitationService } from "@/lambda/shared/services/organization-invitation-service";
export const handler = createPlatformHandler(
  CreateOrganizationInvitationRequestSchema,
  (data, context) =>
    OrganizationInvitationService.create(context.orgId, context.userId, data),
);
