import {
  SalesCustomerIdRequestSchema,
  UpdateSalesCustomerRequestSchema,
} from "@liass-ohada/shared/sales";
import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { SalesCustomerService } from "./sales-customer-service";

export const UpdateSalesCustomerRouteSchema =
  UpdateSalesCustomerRequestSchema.safeExtend({
    customerId: SalesCustomerIdRequestSchema.shape.customerId,
  }).refine(
    (request) =>
      Object.keys(request).some(
        (field) => field !== "expectedVersion" && field !== "customerId",
      ),
    { message: "At least one customer field is required" },
  );

export const handler = createHandler(
  UpdateSalesCustomerRouteSchema,
  async ({ customerId, ...request }, { orgId, userId, i18n }) => ({
    message: i18n.getMessage("SUCCESS_SALES_CUSTOMER_UPDATED"),
    data: await SalesCustomerService.update(orgId, userId, customerId, request),
  }),
  {
    action: "PATCH /sales/customers/{customerId}",
    permission: "SALES_WRITE",
    productCode: "SALES",
  },
);
