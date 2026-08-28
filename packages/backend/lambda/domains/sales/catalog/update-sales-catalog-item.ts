import {
  SalesCatalogItemIdRequestSchema,
  UpdateSalesCatalogItemRequestSchema,
} from "@liass-ohada/shared/sales";
import { createHandler } from "@/lambda/shared/middleware/handler-wrapper";
import { SalesCatalogItemService } from "./sales-catalog-item-service";

export const UpdateSalesCatalogItemRouteSchema =
  UpdateSalesCatalogItemRequestSchema.safeExtend({
    itemId: SalesCatalogItemIdRequestSchema.shape.itemId,
  }).refine(
    (request) =>
      Object.keys(request).some(
        (field) => field !== "expectedVersion" && field !== "itemId",
      ),
    { message: "At least one catalog item field is required" },
  );

export const handler = createHandler(
  UpdateSalesCatalogItemRouteSchema,
  async ({ itemId, ...request }, { orgId, userId, i18n }) => ({
    message: i18n.getMessage("SUCCESS_SALES_ITEM_UPDATED"),
    data: await SalesCatalogItemService.update(orgId, userId, itemId, request),
  }),
  {
    action: "PATCH /sales/items/{itemId}",
    permission: "SALES_WRITE",
    productCode: "SALES",
  },
);
