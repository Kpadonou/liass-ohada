import { ListSalesCatalogItemsRequestSchema } from "@liass-ohada/shared/sales";
import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { SalesCatalogItemService } from "./sales-catalog-item-service";

export const handler = createHandler(
  ListSalesCatalogItemsRequestSchema,
  async (data, { orgId, i18n }) => ({
    message: i18n.getMessage("SUCCESS_SALES_ITEMS_RETRIEVED"),
    data: await SalesCatalogItemService.list(orgId, data),
  }),
  {
    action: "GET /sales/items",
    permission: "SALES_READ",
    productCode: "SALES",
  },
);
