import { CreateSalesCustomerRequestSchema } from "@liass-ohada/shared/sales";
import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { SalesCustomerService } from "./sales-customer-service";

export const handler = createHandler(
  CreateSalesCustomerRequestSchema,
  async (data, { orgId, userId, i18n }) => ({
    message: i18n.getMessage("SUCCESS_SALES_CUSTOMER_CREATED"),
    data: await SalesCustomerService.create(orgId, userId, data),
  }),
  {
    action: "POST /sales/customers",
    permission: "SALES_WRITE",
    productCode: "SALES",
  },
);
