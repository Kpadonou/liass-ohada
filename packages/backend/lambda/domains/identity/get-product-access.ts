import { ProductAccessListResponseSchema } from "@liass-ohada/shared/shared";
import { z } from "zod";
import { createPlatformHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { ProductAccessService } from "@/lambda/shared/services/product-access-service";

export const handler = createPlatformHandler(
  z.object({}).strict(),
  async (_data, context) =>
    ProductAccessListResponseSchema.parse({
      productAccess: await ProductAccessService.listProductAccess(context.orgId),
    }),
);
