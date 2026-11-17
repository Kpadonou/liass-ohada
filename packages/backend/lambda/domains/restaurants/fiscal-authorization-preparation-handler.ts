import * as c from "@liass-ohada/shared/restaurants";
import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { RESTAURANT_FISCAL_AUTHORIZATION_PREPARATION_ROUTE as route } from "./fiscal-authorization-preparation-routes";
import { RestaurantFiscalAuthorizationPreparationService } from "./fiscal-authorization-preparation-service";

const schema = c.RestaurantFiscalAuthorizationPreparationRequestSchema.extend({
  outletId: c.RestaurantIdSchema,
  sessionId: c.RestaurantIdSchema,
  invoiceId: c.RestaurantIdSchema,
}).strict();

export const restaurantFiscalAuthorizationPreparationHandler = createHandler(
  schema,
  async (input, context) => RestaurantFiscalAuthorizationPreparationService.prepare({
    orgId: context.orgId,
    actorId: context.userId,
    outletId: input.outletId,
    sessionId: input.sessionId,
    invoiceId: input.invoiceId,
    scenarioId: input.scenarioId,
    commandId: input.commandId,
  }),
  {
    permission: route.permission,
    productCode: "RESTAURANTS",
    action: "FISCAL_AUTHORIZATION_PREPARE",
  },
);
