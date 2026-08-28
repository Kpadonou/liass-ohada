import { ListSalesCustomersRequestSchema } from "@liass-ohada/shared/sales";
import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { SalesCustomerService } from "./sales-customer-service";

export const handler = createHandler(
  ListSalesCustomersRequestSchema,
  async (data, { orgId, i18n }) => ({
    message: i18n.getMessage("SUCCESS_SALES_CUSTOMERS_RETRIEVED"),
    data: await SalesCustomerService.list(orgId, data),
  }),
  {
    action: "GET /sales/customers",
    permission: "SALES_READ",
    productCode: "SALES",
  },
);
