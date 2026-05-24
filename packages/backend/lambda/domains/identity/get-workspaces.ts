import { createAuthenticatedHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { TenantAccessService } from "@/lambda/shared/services/tenant-access-service";
import { z } from "zod";

export const handler = createAuthenticatedHandler(
  z.object({}),
  async (_data, { userId }) => {
    const workspaces = await TenantAccessService.getUserWorkspaces(userId);

    return { workspaces };
  },
);
