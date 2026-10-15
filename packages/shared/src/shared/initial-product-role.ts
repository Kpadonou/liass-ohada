import { z } from "zod";
import { RestaurantsRoleSchema } from "./restaurants-access";

// ACCOUNTING and SALES have no member-level product-role vocabulary yet.
// Extend this mapping only alongside their canonical authorization contracts.
export const InitialProductRoleIntentSchema = z.discriminatedUnion(
  "productCode",
  [
    z
      .object({
        productCode: z.literal("RESTAURANTS"),
        role: RestaurantsRoleSchema.exclude(["OWNER"]),
      })
      .strict(),
  ],
);
export const AssignInitialProductRoleBodySchema =
  InitialProductRoleIntentSchema.options[0]
    .omit({ productCode: true })
    .extend({ clientRequestId: z.uuid() })
    .strict();
export const AssignInitialProductRoleRequestSchema =
  InitialProductRoleIntentSchema.options[0]
    .extend({
      memberUserId: z.string().min(1).max(256),
      clientRequestId: z.uuid(),
    })
    .strict();
export const AssignInitialProductRoleResponseSchema =
  InitialProductRoleIntentSchema.options[0]
    .extend({ userId: z.string().min(1).max(256) })
    .strict();
export type AssignInitialProductRoleRequest = z.infer<
  typeof AssignInitialProductRoleRequestSchema
>;
export type AssignInitialProductRoleResponse = z.infer<
  typeof AssignInitialProductRoleResponseSchema
>;
