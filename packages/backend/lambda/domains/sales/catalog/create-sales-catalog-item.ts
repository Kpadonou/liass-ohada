import { CreateSalesCatalogItemRequestSchema } from "@liass-ohada/shared/sales";
import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { SalesCatalogItemService } from "./sales-catalog-item-service";

export const handler = createHandler(
  CreateSalesCatalogItemRequestSchema,
  async (data, { orgId, userId, i18n }) => ({
    message: i18n.getMessage("SUCCESS_SALES_ITEM_CREATED"),
    data: await SalesCatalogItemService.create(orgId, userId, data),
  }),
  {
    action: "POST /sales/items",
    permission: "SALES_WRITE",
    productCode: "SALES",
  },
);
