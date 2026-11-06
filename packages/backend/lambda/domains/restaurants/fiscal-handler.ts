import * as c from "@liass-ohada/shared/restaurants";
import {
  AppError,
  createHandler,
} from "@/lambda/shared/middleware/handler-wrapper";
import { RestaurantFiscalApplicationService } from "./fiscal-application-service";
import { RESTAURANT_FISCAL_ROUTES } from "./fiscal-routes";

type Service = Pick<
  RestaurantFiscalApplicationService,
  "initiate" | "confirm" | "status" | "confirmedResult"
>;
/** Explicit dependency injection for local tests; no default credentials, real
 * transport, deployed entrypoint or route registration is provided.
 */
export function restaurantFiscalHandler(
  name: (typeof RESTAURANT_FISCAL_ROUTES)[number]["name"],
  service: Service,
) {
  const route = RESTAURANT_FISCAL_ROUTES.find((v) => v.name === name)!;
  const schema =
    route.operation === "initiate"
      ? c.RestaurantFiscalInitiateRequestSchema
      : route.operation === "confirm"
        ? c.RestaurantFiscalConfirmRequestSchema
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
      process.env.NODE_ENV !== "test" ||
      process.env.FISCAL_SYNTHETIC_APPLICATION !== "1"
    )
      return {
        statusCode: 403,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: { code: "DOMAIN_PERMISSION_REQUIRED" } }),
      };
    return handler(event);
  };
}
