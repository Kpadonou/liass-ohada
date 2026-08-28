import { SalesCustomerIdRequestSchema } from "@liass-ohada/shared/sales";
import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { SalesCustomerService } from "./sales-customer-service";

export const handler = createHandler(
  SalesCustomerIdRequestSchema,
  async ({ customerId }, { orgId, i18n }) => ({
    message: i18n.getMessage("SUCCESS_SALES_CUSTOMER_RETRIEVED"),
    data: await SalesCustomerService.get(orgId, customerId),
  }),
  {
    action: "GET /sales/customers/{customerId}",
    permission: "SALES_READ",
    productCode: "SALES",
  },
);
