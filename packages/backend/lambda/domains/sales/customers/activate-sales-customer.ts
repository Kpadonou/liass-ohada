import { SalesCustomerLifecycleRequestSchema } from "@liass-ohada/shared/sales";
import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { SalesCustomerService } from "./sales-customer-service";

export const handler = createHandler(
  SalesCustomerLifecycleRequestSchema,
  async (data, { orgId, userId, i18n }) => ({
    message: i18n.getMessage("SUCCESS_SALES_CUSTOMER_ACTIVATED"),
    data: await SalesCustomerService.activate(orgId, userId, data),
  }),
  {
    action: "POST /sales/customers/{customerId}/activate",
    permission: "SALES_WRITE",
    productCode: "SALES",
  },
);
