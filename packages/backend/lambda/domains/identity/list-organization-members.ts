import { ListOrganizationMembersRequestSchema } from "@liass-ohada/shared/shared";
import { createPlatformHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { OrganizationMemberService } from "@/lambda/shared/services/organization-member-service";

export const handler = createPlatformHandler(
  ListOrganizationMembersRequestSchema,
  (data, context) =>
    OrganizationMemberService.list(context.orgId, context.userId, data),
);
