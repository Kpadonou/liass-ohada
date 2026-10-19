import { z } from "zod";
import * as c from "@liass-ohada/shared/restaurants";
import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { RestaurantPaymentService } from "./payment-service";
import { RESTAURANT_PAYMENT_ROUTES } from "./payment-routes";
export const handler = createHandler(
  z
    .object({
      ...c.CaptureRestaurantPaymentRequestSchema.shape,
      outletId: c.RestaurantIdSchema,
      sessionId: c.RestaurantIdSchema,
    })
    .strict(),
  async ({ outletId, sessionId, ...request }, context) => {
    const result = await RestaurantPaymentService.capture(
      { orgId: context.orgId, outletId },
      context.userId,
      sessionId,
      request,
    );
    return c.RestaurantPaymentResponseSchema.parse(result);
  },
  {
    permission: RESTAURANT_PAYMENT_ROUTES[0].permission,
    productCode: "RESTAURANTS",
    action: "CAPTURE_PAYMENT",
  },
);
