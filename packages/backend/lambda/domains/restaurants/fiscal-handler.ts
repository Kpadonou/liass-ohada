import { realFiscalTestEnabled } from "../fiscal-compliance/core/test-execution";
import * as c from "@liass-ohada/shared/restaurants";
import {
  AppError,
  createHandler,
} from "@/lambda/shared/middleware/handler-wrapper";
import { RestaurantFiscalApplicationService, fiscalRecoveryRequest } from "./fiscal-application-service";
import { RESTAURANT_FISCAL_ROUTES } from "./fiscal-routes";

type Service = Pick<
  RestaurantFiscalApplicationService,
  "initiate" | "confirm" | "recover" | "status" | "confirmedResult"
>;
/** Shared JWT/tenant/permission boundary. Real TEST entrypoint supplies isolated dependencies. */
export function restaurantFiscalHandler(
  name: (typeof RESTAURANT_FISCAL_ROUTES)[number]["name"],
  service: Service,
  real = false,
) {
  const route = RESTAURANT_FISCAL_ROUTES.find((v) => v.name === name)!;
  const schema =
    route.operation === "initiate"
      ? c.RestaurantFiscalInitiateRequestSchema
      : route.operation === "confirm"
        ? c.RestaurantFiscalConfirmRequestSchema
        : route.operation === "recover"
          ? fiscalRecoveryRequest
          : c.RestaurantFiscalSourceRequestSchema;
  const handler = createHandler(
    schema,
    async (input, context) => {
      const result = await service[route.operation](
        { orgId: context.orgId, userId: context.userId },
        input,
      );
      const response =
        route.operation === "confirmedResult" || route.operation === "confirm"
          ? c.RestaurantFiscalResultResponseSchema.safeParse(result)
          : c.RestaurantFiscalStatusResponseSchema.safeParse(result);
      if (!response.success || response.data.invoiceId !== input.invoiceId)
        throw new AppError(500, "ERROR_INTERNAL_SERVER");
      return response.data;
    },
    {
      permission: route.permission,
      productCode: "RESTAURANTS",
      action: `FISCAL_${route.operation.toUpperCase()}`,
    },
  );
  // Guard before middleware: a disabled handler cannot reach identity reads or a service.
  return async (event: Parameters<typeof handler>[0]) => {
    if (
      real ? !realFiscalTestEnabled() : (process.env.NODE_ENV !== "test" ||
      process.env.FISCAL_SYNTHETIC_APPLICATION !== "1")
    )
      return {
        statusCode: 403,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: { code: "DOMAIN_PERMISSION_REQUIRED" } }),
      };
    return handler(event);
  };
}
