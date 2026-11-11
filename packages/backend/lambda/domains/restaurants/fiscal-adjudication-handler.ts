import * as c from "@liass-ohada/shared/restaurants";
import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { fiscalAdjudicationEnabled } from "../fiscal-compliance/core/test-execution";
import { RestaurantFiscalAdjudicationService } from "./fiscal-adjudication-service";

const service = new RestaurantFiscalAdjudicationService();

/** Separate from the real executor gate: this route has no provider transport. */
export function restaurantFiscalAdjudicationHandler(
  adjudicator: Pick<RestaurantFiscalAdjudicationService, "adjudicate"> = service,
) {
  const handler = createHandler(
    c.RestaurantFiscalSourceRequestSchema,
    async (input, context) => adjudicator.adjudicate(
      { orgId: context.orgId, userId: context.userId },
      input,
    ),
    {
      permission: "RESTAURANTS_RECEIPT_MANAGE",
      productCode: "RESTAURANTS",
      action: "FISCAL_ADJUDICATE",
    },
  );
  return async (event: Parameters<typeof handler>[0]) => {
    if (!fiscalAdjudicationEnabled())
      return {
        statusCode: 403,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: { code: "DOMAIN_PERMISSION_REQUIRED" } }),
      };
    return handler(event);
  };
}
