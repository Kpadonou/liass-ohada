import { SalesCustomerLifecycleRequestSchema } from "@liass-ohada/shared/sales";
import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { SalesCustomerService } from "./sales-customer-service";

export const handler = createHandler(
  SalesCustomerLifecycleRequestSchema,
  async (data, { orgId, userId, i18n }) => ({
    message: i18n.getMessage("SUCCESS_SALES_CUSTOMER_DEACTIVATED"),
    data: await SalesCustomerService.deactivate(orgId, userId, data),
  }),
  {
    action: "POST /sales/customers/{customerId}/deactivate",
    permission: "SALES_WRITE",
    productCode: "SALES",
  },
);
