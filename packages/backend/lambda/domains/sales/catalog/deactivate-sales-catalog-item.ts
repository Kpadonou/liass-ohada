import { SalesCatalogItemLifecycleRequestSchema } from "@liass-ohada/shared/sales";
import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { SalesCatalogItemService } from "./sales-catalog-item-service";

export const handler = createHandler(
  SalesCatalogItemLifecycleRequestSchema,
  async (data, { orgId, userId, i18n }) => ({
    message: i18n.getMessage("SUCCESS_SALES_ITEM_DEACTIVATED"),
    data: await SalesCatalogItemService.deactivate(orgId, userId, data),
  }),
  {
    action: "POST /sales/items/{itemId}/deactivate",
    permission: "SALES_WRITE",
    productCode: "SALES",
  },
);
