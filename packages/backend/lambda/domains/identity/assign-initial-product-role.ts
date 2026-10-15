import { AssignInitialProductRoleRequestSchema } from "@liass-ohada/shared/shared";
import { createPlatformHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { InitialProductRoleService } from "@/lambda/shared/services/initial-product-role-service";

export const handler = createPlatformHandler(
  AssignInitialProductRoleRequestSchema,
  (data, context) =>
    InitialProductRoleService.assign(context.orgId, context.userId, data),
);
