import { SalesCatalogItemIdRequestSchema } from "@liass-ohada/shared/sales";
import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { SalesCatalogItemService } from "./sales-catalog-item-service";

export const handler = createHandler(
  SalesCatalogItemIdRequestSchema,
  async ({ itemId }, { orgId, i18n }) => ({
    message: i18n.getMessage("SUCCESS_SALES_ITEM_RETRIEVED"),
    data: await SalesCatalogItemService.get(orgId, itemId),
  }),
  {
    action: "GET /sales/items/{itemId}",
    permission: "SALES_READ",
    productCode: "SALES",
  },
);
